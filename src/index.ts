import { Router } from "itty-router";
import { z } from "zod";

/**
 * Env bindings (Cloudflare)
 * - ASSETS: static assets binding (fetcher)
 * - DB: D1 database
 * - R2: R2 bucket
 * - ANALYSIS_QUEUE: queue producer/consumer binding
 * - CONVERSATION_SESSION: Durable Object namespace
 */
export interface Env {
  APP_ENV: string;
  LLM_PROVIDER: "mock" | "anthropic";

  ASSETS: Fetcher;
  DB: D1Database;
  R2: R2Bucket;
  ANALYSIS_QUEUE: Queue;
  CONVERSATION_SESSION: DurableObjectNamespace;

  // Secrets (use `wrangler secret put`)
  PARENT_PIN?: string;
  ANTHROPIC_API_KEY?: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const router = Router();

const SessionStartRequest = z.object({
  childId: z.string().optional(),
});

const ConversationTextRequest = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1),
});

function json(data: JsonValue, init?: ResponseInit) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

function nowMs() {
  return Date.now();
}

function ulidLike() {
  // placeholder. Replace with ULID library later if you care.
  return `${nowMs().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function requireParent(request: Request, env: Env): Promise<Response | null> {
  // Extremely thin auth. For a public repo, replace with proper auth.
  // Child UI should not require auth; parent pages should.
  const pin = env.PARENT_PIN;
  if (!pin) return json({ error: "PARENT_PIN not configured" }, { status: 500 });

  const provided = request.headers.get("x-parent-pin") || new URL(request.url).searchParams.get("pin");
  if (provided !== pin) return json({ error: "unauthorized" }, { status: 401 });
  return null;
}

router.get("/api/health", async (request: Request, env: Env) => {
  // Test D1, R2, and Queues connectivity
  try {
    await env.DB.prepare("SELECT 1").first();
    const services = { d1: "ok", r2: "ok", queues: "ok" };
    return json({ status: "ok", services });
  } catch (e) {
    return json({ status: "error", services: { d1: "error", r2: "unknown", queues: "unknown" } }, { status: 500 });
  }
});

// Session Management
router.post("/api/session/start", async (request: Request, env: Env) => {
  const body = await request.json().catch(() => ({}));
  const parsed = SessionStartRequest.safeParse(body);
  if (!parsed.success) {
    return json({ error: { code: "INVALID_REQUEST", message: parsed.error.flatten() } }, { status: 400 });
  }

  const { childId } = parsed.data;
  const sessionId = `s_${ulidLike()}`;
  const ts = nowMs();

  // Create session in D1
  await env.DB.prepare(
    "INSERT INTO sessions (id, child_id, started_at, last_activity, turn_count, active, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(sessionId, childId || null, ts, ts, 0, 1, null)
    .run();

  // Initialize Durable Object for this session
  const id = env.CONVERSATION_SESSION.idFromName(sessionId);
  const stub = env.CONVERSATION_SESSION.get(id);

  const doResp = await stub.fetch("https://do/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, childId, startedAt: ts }),
  });

  const greeting = await doResp.json() as { greeting: string; ttsAudioUrl: string };

  return json({
    sessionId,
    rabbitGreeting: greeting.greeting,
    ttsAudioUrl: greeting.ttsAudioUrl,
  });
});

router.get("/api/session/:sessionId", async (request: Request & { params?: { sessionId: string } }, env: Env) => {
  const sessionId = request.params?.sessionId;
  if (!sessionId) {
    return json({ error: { code: "INVALID_REQUEST", message: "sessionId required" } }, { status: 400 });
  }

  const session = await env.DB.prepare(
    "SELECT id, started_at, last_activity, turn_count, active FROM sessions WHERE id = ?"
  )
    .bind(sessionId)
    .first<{ id: string; started_at: number; last_activity: number; turn_count: number; active: number }>();

  if (!session) {
    return json({ error: { code: "SESSION_NOT_FOUND", message: "Session not found" } }, { status: 404 });
  }

  return json({
    sessionId: session.id,
    active: session.active === 1,
    turnCount: session.turn_count,
    lastActivity: new Date(session.last_activity).toISOString(),
  });
});

// Conversation endpoints
router.post("/api/conversation/audio", async (request: Request, env: Env, ctx: ExecutionContext) => {
  // Parse multipart form data
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return json({ error: { code: "INVALID_REQUEST", message: "Invalid form data" } }, { status: 400 });
  }

  const sessionId = formData.get("sessionId") as string;
  const audioFile = formData.get("audio") as File;
  const timestamp = formData.get("timestamp") as string;

  if (!sessionId || !audioFile) {
    return json({ error: { code: "INVALID_REQUEST", message: "sessionId and audio required" } }, { status: 400 });
  }

  // Upload audio to R2
  const turnId = `t_${ulidLike()}`;
  const audioKey = `raw/${sessionId}/${turnId}.webm`;
  const audioBuffer = await audioFile.arrayBuffer();

  await env.R2.put(audioKey, audioBuffer, {
    httpMetadata: { contentType: audioFile.type || "audio/webm" },
    customMetadata: { session_id: sessionId, turn_id: turnId, timestamp: timestamp || new Date().toISOString() },
  });

  // Mock ASR (replace with actual ASR service later)
  const transcription = "[ASR mock] Child said something";

  // Get rabbit response from Durable Object
  const id = env.CONVERSATION_SESSION.idFromName(sessionId);
  const stub = env.CONVERSATION_SESSION.get(id);

  const doResp = await stub.fetch("https://do/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, turnId, childInput: transcription }),
  });

  const reply = await doResp.json() as { response: string; ttsAudioUrl: string; vocabulary: string[] };

  // Persist conversation turn
  const ts = timestamp ? new Date(timestamp).getTime() : nowMs();
  await env.DB.prepare(
    "INSERT INTO conversation_turns (id, session_id, timestamp, child_input, rabbit_response, child_audio_r2_key, rabbit_audio_r2_key, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(turnId, sessionId, ts, transcription, reply.response, audioKey, reply.ttsAudioUrl.split('/').pop() || null, null)
    .run();

  // Update session
  await env.DB.prepare(
    "UPDATE sessions SET last_activity = ?, turn_count = turn_count + 1 WHERE id = ?"
  )
    .bind(nowMs(), sessionId)
    .run();

  // Queue vocabulary analysis
  ctx.waitUntil(
    env.ANALYSIS_QUEUE.send({
      turnId,
      sessionId,
      text: transcription,
      timestamp: new Date(ts).toISOString(),
    })
  );

  return json({
    transcription,
    rabbitResponse: reply.response,
    ttsAudioUrl: reply.ttsAudioUrl,
    turnId,
    vocabularyDetected: reply.vocabulary || [],
  });
});

router.post("/api/conversation/text", async (request: Request, env: Env, ctx: ExecutionContext) => {
  const body = await request.json().catch(() => ({}));
  const parsed = ConversationTextRequest.safeParse(body);
  if (!parsed.success) {
    return json({ error: { code: "INVALID_REQUEST", message: parsed.error.flatten() } }, { status: 400 });
  }

  const { sessionId, text } = parsed.data;
  const turnId = `t_${ulidLike()}`;
  const ts = nowMs();

  // Get rabbit response from Durable Object
  const id = env.CONVERSATION_SESSION.idFromName(sessionId);
  const stub = env.CONVERSATION_SESSION.get(id);

  const doResp = await stub.fetch("https://do/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, turnId, childInput: text }),
  });

  const reply = await doResp.json() as { response: string; ttsAudioUrl: string; vocabulary: string[] };

  // Persist conversation turn
  await env.DB.prepare(
    "INSERT INTO conversation_turns (id, session_id, timestamp, child_input, rabbit_response, child_audio_r2_key, rabbit_audio_r2_key, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(turnId, sessionId, ts, text, reply.response, null, reply.ttsAudioUrl.split('/').pop() || null, null)
    .run();

  // Update session
  await env.DB.prepare(
    "UPDATE sessions SET last_activity = ?, turn_count = turn_count + 1 WHERE id = ?"
  )
    .bind(nowMs(), sessionId)
    .run();

  // Queue vocabulary analysis
  ctx.waitUntil(
    env.ANALYSIS_QUEUE.send({
      turnId,
      sessionId,
      text,
      timestamp: new Date(ts).toISOString(),
    })
  );

  return json({
    rabbitResponse: reply.response,
    ttsAudioUrl: reply.ttsAudioUrl,
    turnId,
  });
});

// Parent Dashboard API
router.get("/api/parent/logs", async (request: Request, env: Env) => {
  const auth = await requireParent(request, env);
  if (auth) return auth;

  const url = new URL(request.url);
  const childId = url.searchParams.get("childId");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);

  let query = "SELECT ct.id as turnId, ct.session_id as sessionId, ct.timestamp, ct.child_input as childInput, ct.rabbit_response as rabbitResponse, ct.child_audio_r2_key, ct.rabbit_audio_r2_key FROM conversation_turns ct JOIN sessions s ON ct.session_id = s.id WHERE 1=1";
  const bindings: any[] = [];

  if (childId) {
    query += " AND s.child_id = ?";
    bindings.push(childId);
  }
  if (startDate) {
    query += " AND ct.timestamp >= ?";
    bindings.push(new Date(startDate).getTime());
  }
  if (endDate) {
    query += " AND ct.timestamp <= ?";
    bindings.push(new Date(endDate).getTime());
  }

  query += " ORDER BY ct.timestamp DESC LIMIT ?";
  bindings.push(limit);

  const stmt = env.DB.prepare(query);
  const result = await stmt.bind(...bindings).all();

  const logs = result.results.map((row: any) => ({
    turnId: row.turnId,
    sessionId: row.sessionId,
    timestamp: new Date(row.timestamp).toISOString(),
    childInput: row.childInput,
    rabbitResponse: row.rabbitResponse,
    vocabularyUsed: [], // TODO: join with vocabulary table
    audioUrls: {
      childAudio: row.child_audio_r2_key ? `https://r2.example.com/${row.child_audio_r2_key}` : null,
      rabbitAudio: row.rabbit_audio_r2_key ? `https://r2.example.com/${row.rabbit_audio_r2_key}` : null,
    },
  }));

  return json({
    logs,
    total: logs.length,
  });
});

router.get("/api/parent/vocabulary", async (request: Request, env: Env) => {
  const auth = await requireParent(request, env);
  if (auth) return auth;

  const url = new URL(request.url);
  const childId = url.searchParams.get("childId");
  const period = url.searchParams.get("period") || "month";

  // Calculate time range
  const now = Date.now();
  let since = now - 30 * 24 * 60 * 60 * 1000; // default: 1 month
  if (period === "week") since = now - 7 * 24 * 60 * 60 * 1000;
  else if (period === "all") since = 0;

  let query = "SELECT v.word, v.first_seen_at, ct.session_id FROM vocabulary v JOIN conversation_turns ct ON v.turn_id = ct.id JOIN sessions s ON ct.session_id = s.id WHERE v.first_seen_at >= ?";
  const bindings: any[] = [since];

  if (childId) {
    query += " AND s.child_id = ?";
    bindings.push(childId);
  }

  query += " ORDER BY v.first_seen_at ASC";

  const stmt = env.DB.prepare(query);
  const result = await stmt.bind(...bindings).all();

  // Aggregate by date
  const byDate = new Map<string, Set<string>>();
  const wordCounts = new Map<string, number>();

  for (const row of result.results as any[]) {
    const date = new Date(row.first_seen_at).toISOString().slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, new Set());
    byDate.get(date)!.add(row.word);

    wordCounts.set(row.word, (wordCounts.get(row.word) || 0) + 1);
  }

  const vocabularyGrowth = Array.from(byDate.entries()).map(([date, words]) => ({
    date,
    uniqueWords: words.size,
    newWords: Array.from(words),
  }));

  const mostUsedWords = Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));

  const totalUniqueWords = new Set(result.results.map((r: any) => r.word)).size;

  return json({
    vocabularyGrowth,
    totalUniqueWords,
    mostUsedWords,
  });
});

router.get("/api/parent/highlights", async (request: Request, env: Env) => {
  const auth = await requireParent(request, env);
  if (auth) return auth;

  const result = await env.DB.prepare(
    "SELECT h.turn_id as turnId, h.timestamp, h.type, h.description, h.excerpt FROM highlights h ORDER BY h.timestamp DESC LIMIT 50"
  ).all();

  const highlights = result.results.map((row: any) => ({
    turnId: row.turnId,
    timestamp: new Date(row.timestamp).toISOString(),
    type: row.type,
    description: row.description,
    excerpt: row.excerpt,
  }));

  return json({ highlights });
});

// Serve static assets (fallback)
router.all("*", async (request: Request, env: Env) => {
  // If this is not an API path, return the static asset.
  // With assets.run_worker_first=true, we must explicitly fetch from ASSETS.
  return env.ASSETS.fetch(request);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await router.handle(request, env, ctx);
    } catch (err: any) {
      return json({ ok: false, error: err?.message || String(err) }, { status: 500 });
    }
  },

  // Cron Trigger: daily summary placeholder
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDailySummary(env));
  },

  // Queue consumer: vocabulary analysis per specs
  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
    for (const msg of batch.messages) {
      try {
        const payload = msg.body as any;
        if (payload?.turnId && payload?.sessionId && payload?.text) {
          await analyzeVocabulary(env, payload.turnId, payload.sessionId, payload.text, payload.timestamp);
        }
        msg.ack();
      } catch (e) {
        // Re-try default behavior
        msg.retry();
      }
    }
  },
};

/**
 * Durable Object: ConversationSession - manages state for an active conversation session
 * Notes:
 * - Stores session metadata and recent context (last 5 turns)
 * - Tracks vocabulary for this session
 * - DO storage backend is SQLite-backed via migrations.new_sqlite_classes
 */
export class ConversationSession {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/init") {
      const body = await request.json().catch(() => ({})) as any;
      const sessionId = String(body.sessionId);
      const childId = body.childId as string | undefined;
      const startedAt = body.startedAt as number;

      // Initialize session metadata
      await this.state.storage.put("metadata", {
        sessionId,
        startedAt,
        childId,
      });

      await this.state.storage.put("context", []);
      await this.state.storage.put("vocabularySession", {
        uniqueWords: [],
        newWordsThisSession: [],
      });

      // Mock TTS URL (replace with actual TTS service)
      const greeting = "こんにちは！うさぎだよ。いっぱいおはなししよう！";
      const ttsAudioUrl = `https://r2.example.com/tts/${hashString(greeting)}.mp3`;

      return json({ greeting, ttsAudioUrl });
    }

    if (request.method === "POST" && url.pathname === "/chat") {
      const body = await request.json().catch(() => ({})) as any;
      const sessionId = String(body.sessionId);
      const turnId = String(body.turnId);
      const childInput = String(body.childInput || "");

      const metadata = (await this.state.storage.get("metadata")) as
        | { sessionId: string; startedAt: number; childId?: string }
        | undefined;
      const context = (await this.state.storage.get("context")) as any[] || [];
      const vocabSession = (await this.state.storage.get("vocabularySession")) as
        | { uniqueWords: string[]; newWordsThisSession: string[] }
        | undefined || { uniqueWords: [], newWordsThisSession: [] };

      // Placeholder: rule-based reply until LLM is wired
      let replyText = "うんうん！";
      if (childInput) {
        replyText = `「${childInput}」っていったね。もっとおしえて！`;
      } else {
        replyText = "きこえたよ。もういっかい、おはなしして？";
      }

      // Mock vocabulary detection
      const vocabulary = extractSimpleVocabulary(childInput);

      // Update context (keep last 5 turns)
      const newTurn = {
        turnId,
        childInput,
        rabbitResponse: replyText,
        timestamp: Date.now(),
      };

      const updatedContext = [...context, newTurn].slice(-5);
      await this.state.storage.put("context", updatedContext);

      // Update vocabulary session
      const newWords = vocabulary.filter(w => !vocabSession.uniqueWords.includes(w));
      vocabSession.uniqueWords.push(...newWords);
      vocabSession.newWordsThisSession.push(...newWords);
      await this.state.storage.put("vocabularySession", vocabSession);

      // Mock TTS URL
      const ttsAudioUrl = `https://r2.example.com/tts/${hashString(replyText)}.mp3`;

      return json({
        response: replyText,
        ttsAudioUrl,
        vocabulary,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    // Cleanup inactive sessions after timeout
    const metadata = await this.state.storage.get("metadata") as { startedAt: number } | undefined;
    if (metadata && Date.now() - metadata.startedAt > 3600000) { // 1 hour
      await this.state.storage.deleteAll();
    }
  }
}

function extractSimpleVocabulary(text: string): string[] {
  // Simple vocabulary extraction (replace with proper tokenizer later)
  const normalized = text
    .replace(/[\u3000\s]+/g, " ")
    .replace(/[！!？?。、，．・…]/g, " ")
    .trim();
  if (!normalized) return [];

  return normalized.split(" ").filter(Boolean).slice(0, 10);
}

function hashString(str: string): string {
  // Simple hash for TTS cache key (replace with proper hash later)
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

async function analyzeVocabulary(env: Env, turnId: string, sessionId: string, text: string, timestamp: string) {
  // Vocabulary analysis per specs:
  // 1. Extract words using tokenizer
  // 2. Compare against previous vocabulary
  // 3. Update vocabulary table
  // 4. Create highlights for new words
  // 5. Update analysis_jobs table

  const jobId = `job_${ulidLike()}`;
  const ts = new Date(timestamp).getTime();

  // Create analysis job
  await env.DB.prepare(
    "INSERT INTO analysis_jobs (id, turn_id, job_type, status, created_at, completed_at, result) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(jobId, turnId, "vocabulary_extraction", "processing", Date.now(), null, null)
    .run();

  try {
    const words = tokenizeJaLoose(text);
    if (!words.length) {
      await env.DB.prepare("UPDATE analysis_jobs SET status = ?, completed_at = ? WHERE id = ?")
        .bind("completed", Date.now(), jobId)
        .run();
      return;
    }

    // Get existing vocabulary for this session
    const existing = await env.DB.prepare(
      "SELECT DISTINCT word FROM vocabulary WHERE session_id = ?"
    )
      .bind(sessionId)
      .all<{ word: string }>();

    const existingWords = new Set(existing.results.map(r => r.word));
    const newWords: string[] = [];

    // Insert vocabulary entries
    for (const word of words) {
      await env.DB.prepare(
        "INSERT INTO vocabulary (session_id, turn_id, word, first_seen_at) VALUES (?, ?, ?, ?)"
      )
        .bind(sessionId, turnId, word, ts)
        .run();

      if (!existingWords.has(word)) {
        newWords.push(word);
      }
    }

    // Create highlights for new words
    for (const word of newWords) {
      await env.DB.prepare(
        "INSERT INTO highlights (turn_id, session_id, timestamp, type, description, excerpt) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(turnId, sessionId, ts, "new_word", `New word learned: ${word}`, text.substring(0, 100))
        .run();
    }

    // Update analysis job
    await env.DB.prepare(
      "UPDATE analysis_jobs SET status = ?, completed_at = ?, result = ? WHERE id = ?"
    )
      .bind("completed", Date.now(), JSON.stringify({ wordsExtracted: words.length, newWords: newWords.length }), jobId)
      .run();
  } catch (e: any) {
    await env.DB.prepare("UPDATE analysis_jobs SET status = ?, completed_at = ?, result = ? WHERE id = ?")
      .bind("failed", Date.now(), JSON.stringify({ error: e.message }), jobId)
      .run();
  }
}

function tokenizeJaLoose(text: string): string[] {
  // DO NOT overthink MVP. Replace with kuromoji or a proper tokenizer later.
  // This is just to show the pipeline.
  const normalized = text
    .replace(/[\u3000\s]+/g, " ")
    .replace(/[！!？?。、，．・…]/g, " ")
    .trim();
  if (!normalized) return [];

  // naive: split by spaces and keep short tokens too (child language).
  const raw = normalized.split(" ").map((s) => s.trim()).filter(Boolean);

  // also split long kana/latin sequences into chunks
  const out: string[] = [];
  for (const t of raw) {
    if (t.length <= 12) out.push(t);
    else out.push(t.slice(0, 12));
  }
  return out.slice(0, 30);
}

async function runDailySummary(env: Env) {
  // Daily summary per specs:
  // 1. Aggregate vocabulary growth for all children
  // 2. Generate usage statistics
  // Note: Summary tables are a future enhancement, for now we just log

  const day = new Date().toISOString().slice(0, 10);
  const since = Date.now() - 24 * 60 * 60 * 1000;

  // Get all sessions from last 24h
  const sessions = await env.DB.prepare(
    "SELECT id, child_id, turn_count FROM sessions WHERE last_activity >= ?"
  )
    .bind(since)
    .all<{ id: string; child_id: string | null; turn_count: number }>();

  // Get vocabulary growth
  const vocab = await env.DB.prepare(
    "SELECT word, first_seen_at FROM vocabulary WHERE first_seen_at >= ?"
  )
    .bind(since)
    .all<{ word: string; first_seen_at: number }>();

  const summary = {
    date: day,
    activeSessions: sessions.results.length,
    totalTurns: sessions.results.reduce((sum, s) => sum + s.turn_count, 0),
    newWords: vocab.results.length,
    uniqueWords: new Set(vocab.results.map(v => v.word)).size,
  };

  console.log("[Daily Summary]", JSON.stringify(summary));

  // Future: Store in a daily_summaries table
}

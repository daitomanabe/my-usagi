import { Router } from "itty-router";
import { z } from "zod";

/**
 * Env bindings (Cloudflare)
 * - ASSETS: static assets binding (fetcher)
 * - DB: D1 database
 * - R2: R2 bucket
 * - ANALYSIS_QUEUE: queue producer/consumer binding
 * - BUNNY_SESSION: Durable Object namespace
 */
export interface Env {
  APP_ENV: string;
  LLM_PROVIDER: "mock" | "anthropic";

  ASSETS: Fetcher;
  DB: D1Database;
  R2: R2Bucket;
  ANALYSIS_QUEUE: Queue;
  BUNNY_SESSION: DurableObjectNamespace;

  // Secrets (use `wrangler secret put`)
  PARENT_PIN?: string;
  ANTHROPIC_API_KEY?: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const router = Router();

const ChatRequest = z.object({
  profileId: z.string().min(1).default("default"),
  sessionId: z.string().optional(),
  text: z.string().optional(),
  audioR2Key: z.string().optional(),
  asr: z
    .object({
      provider: z.string().optional(),
      confidence: z.number().optional(),
    })
    .optional(),
  meta: z.record(z.any()).optional(),
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

router.get("/api/health", () => json({ ok: true, ts: nowMs() }));

// Upload raw audio to R2
router.post("/api/audio/upload", async (request: Request, env: Env) => {
  const contentType = request.headers.get("content-type") || "application/octet-stream";
  const buf = await request.arrayBuffer();
  const key = `audio/raw/${new Date().toISOString().slice(0, 10)}/${ulidLike()}.webm`;

  await env.R2.put(key, buf, { httpMetadata: { contentType } });

  return json({ ok: true, r2Key: key });
});

// Chat endpoint: persist event, forward to Durable Object to get reply
router.post("/api/chat", async (request: Request, env: Env, ctx: ExecutionContext) => {
  const body = await request.json().catch(() => ({}));
  const parsed = ChatRequest.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const { profileId, text, audioR2Key, asr, meta } = parsed.data;

  const sessionId = parsed.data.sessionId || `s_${new Date().toISOString().slice(0, 10)}_${ulidLike()}`;

  // Ensure profile exists (idempotent)
  await env.DB.prepare(
    "INSERT OR IGNORE INTO profiles (id, display_name, created_at) VALUES (?, ?, ?)"
  )
    .bind(profileId, "my kid", nowMs())
    .run();

  await env.DB.prepare(
    "INSERT OR IGNORE INTO sessions (id, profile_id, started_at) VALUES (?, ?, ?)"
  )
    .bind(sessionId, profileId, nowMs())
    .run();

  // Persist child event
  const eventId = `e_${ulidLike()}`;
  await env.DB.prepare(
    "INSERT INTO events (id, profile_id, session_id, created_at, source, modality, text, audio_r2_key, asr_provider, asr_confidence, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      eventId,
      profileId,
      sessionId,
      nowMs(),
      "child",
      audioR2Key ? "audio" : "text",
      text || null,
      audioR2Key || null,
      asr?.provider || null,
      asr?.confidence || null,
      meta ? JSON.stringify(meta) : null
    )
    .run();

  // Queue async analysis (placeholder)
  ctx.waitUntil(
    env.ANALYSIS_QUEUE.send({
      type: "analyze_event",
      profileId,
      sessionId,
      eventId,
    })
  );

  // Durable Object reply
  const id = env.BUNNY_SESSION.idFromName(profileId);
  const stub = env.BUNNY_SESSION.get(id);

  const doResp = await stub.fetch("https://do/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profileId,
      sessionId,
      text,
      audioR2Key,
      meta,
    }),
  });

  const reply = (await doResp.json().catch(() => null)) as any;

  // Persist bunny event
  if (reply?.text) {
    const bunnyEventId = `e_${ulidLike()}`;
    await env.DB.prepare(
      "INSERT INTO events (id, profile_id, session_id, created_at, source, modality, text, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        bunnyEventId,
        profileId,
        sessionId,
        nowMs(),
        "bunny",
        "text",
        reply.text,
        reply?.meta ? JSON.stringify(reply.meta) : null
      )
      .run();
  }

  return json({
    ok: true,
    profileId,
    sessionId,
    reply,
  });
});

// Parent dashboard API (placeholder)
router.get("/api/parent/summary", async (request: Request, env: Env) => {
  const auth = await requireParent(request, env);
  if (auth) return auth;

  const profileId = new URL(request.url).searchParams.get("profileId") || "default";

  const last = await env.DB.prepare(
    "SELECT id, created_at, source, modality, text, audio_r2_key FROM events WHERE profile_id = ? ORDER BY created_at DESC LIMIT 20"
  )
    .bind(profileId)
    .all();

  const vocab = await env.DB.prepare(
    "SELECT token, count, first_seen_at, last_seen_at FROM vocab_items WHERE profile_id = ? ORDER BY last_seen_at DESC LIMIT 50"
  )
    .bind(profileId)
    .all();

  return json({
    ok: true,
    profileId,
    recentEvents: last.results,
    vocab: vocab.results,
  });
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

  // Queue consumer: async analysis placeholder
  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
    for (const msg of batch.messages) {
      try {
        const payload = msg.body as any;
        if (payload?.type === "analyze_event") {
          await analyzeEvent(env, payload.profileId, payload.sessionId, payload.eventId);
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
 * Durable Object: keeps short-term "my usagi" memory per profile
 * Notes:
 * - We keep this deliberately minimal; DO storage backend is SQLite-backed via migrations.new_sqlite_classes.
 */
export class BunnySession {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/chat") {
      const body = await request.json().catch(() => ({}));
      const profileId = String(body.profileId || "default");
      const sessionId = String(body.sessionId || "unknown");
      const text = typeof body.text === "string" ? body.text : "";

      const memoryKey = "memory_v1";
      const memory = (await this.state.storage.get(memoryKey)) as
        | { lastUserText?: string; mood?: string; turn?: number }
        | undefined;

      const turn = (memory?.turn ?? 0) + 1;

      // Placeholder: rule-based reply until LLM is wired.
      let replyText = "うんうん！";
      if (text) {
        replyText = `「${text}」っていったね。もっとおしえて！`;
      } else {
        replyText = "きこえたよ。もういっかい、おはなしして？";
      }

      const next = { lastUserText: text, mood: "curious", turn };
      await this.state.storage.put(memoryKey, next);

      return json({
        ok: true,
        text: replyText,
        meta: { profileId, sessionId, turn, mood: next.mood },
      });
    }

    return new Response("Not found", { status: 404 });
  }
}

async function analyzeEvent(env: Env, profileId: string, sessionId: string, eventId: string) {
  // Placeholder analysis:
  // - Pull event text
  // - Extract naive "vocab" tokens and upsert counts
  const row = await env.DB.prepare("SELECT text, created_at FROM events WHERE id = ? AND profile_id = ?")
    .bind(eventId, profileId)
    .first<{ text: string | null; created_at: number }>();

  const text = row?.text || "";
  if (!text) return;

  const tokens = tokenizeJaLoose(text);
  const ts = row?.created_at || Date.now();

  for (const token of tokens) {
    const id = `v_${profileId}_${token}`;
    await env.DB.prepare(
      "INSERT INTO vocab_items (id, profile_id, first_seen_at, last_seen_at, token, count) VALUES (?, ?, ?, ?, ?, 1) " +
        "ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, count = count + 1"
    )
      .bind(id, profileId, ts, ts, token)
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
  // Placeholder daily summary:
  // - Pick last 24h events and write a markdown summary
  const profileId = "default";
  const day = new Date().toISOString().slice(0, 10);

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const rows = await env.DB.prepare(
    "SELECT source, text, created_at FROM events WHERE profile_id = ? AND created_at >= ? ORDER BY created_at ASC"
  )
    .bind(profileId, since)
    .all<{ source: string; text: string | null; created_at: number }>();

  const lines = rows.results
    .filter((r) => r.text)
    .map((r) => `- **${r.source}**: ${r.text}`);

  const md = `# Daily summary (${day})\n\n` + (lines.join("\n") || "_No events yet._");

  const id = `ds_${profileId}_${day}`;
  await env.DB.prepare(
    "INSERT INTO daily_summaries (id, profile_id, day_ymd, created_at, summary_markdown) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(profile_id, day_ymd) DO UPDATE SET created_at = excluded.created_at, summary_markdown = excluded.summary_markdown"
  )
    .bind(id, profileId, day, Date.now(), md)
    .run();
}

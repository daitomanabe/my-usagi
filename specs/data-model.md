# Data Model - my-usagi

## D1 Database Schema

### Tables

#### 1. sessions
Tracks conversation sessions.

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,  -- UUID
  child_id TEXT,        -- optional identifier
  started_at INTEGER NOT NULL,  -- Unix timestamp (ms)
  last_activity INTEGER NOT NULL,
  turn_count INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,  -- 0 = inactive, 1 = active
  metadata TEXT  -- JSON: { device_info, etc }
);

CREATE INDEX idx_sessions_child ON sessions(child_id);
CREATE INDEX idx_sessions_started ON sessions(started_at);
CREATE INDEX idx_sessions_active ON sessions(active);
```

#### 2. conversation_turns
Individual exchanges between child and rabbit.

```sql
CREATE TABLE conversation_turns (
  id TEXT PRIMARY KEY,  -- UUID
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,  -- Unix timestamp (ms)
  child_input TEXT,  -- transcribed text
  rabbit_response TEXT,
  child_audio_r2_key TEXT,  -- R2 object key
  rabbit_audio_r2_key TEXT,
  duration_ms INTEGER,  -- audio duration
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_turns_session ON conversation_turns(session_id);
CREATE INDEX idx_turns_timestamp ON conversation_turns(timestamp);
```

#### 3. vocabulary
Vocabulary usage tracking.

```sql
CREATE TABLE vocabulary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  word TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,  -- Unix timestamp (ms)
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (turn_id) REFERENCES conversation_turns(id)
);

CREATE INDEX idx_vocabulary_session ON vocabulary(session_id);
CREATE INDEX idx_vocabulary_word ON vocabulary(word);
CREATE INDEX idx_vocabulary_first_seen ON vocabulary(first_seen_at);
```

#### 4. highlights
Notable conversation moments.

```sql
CREATE TABLE highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,  -- 'new_word', 'long_sentence', 'emotional_moment'
  description TEXT,
  excerpt TEXT,  -- relevant text snippet
  FOREIGN KEY (turn_id) REFERENCES conversation_turns(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_highlights_session ON highlights(session_id);
CREATE INDEX idx_highlights_timestamp ON highlights(timestamp);
CREATE INDEX idx_highlights_type ON highlights(type);
```

#### 5. analysis_jobs
Tracks async analysis jobs (via Queues).

```sql
CREATE TABLE analysis_jobs (
  id TEXT PRIMARY KEY,  -- UUID
  turn_id TEXT NOT NULL,
  job_type TEXT NOT NULL,  -- 'vocabulary_extraction', 'sentiment_analysis', etc
  status TEXT DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed'
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  result TEXT,  -- JSON result
  FOREIGN KEY (turn_id) REFERENCES conversation_turns(id)
);

CREATE INDEX idx_jobs_status ON analysis_jobs(status);
CREATE INDEX idx_jobs_turn ON analysis_jobs(turn_id);
```

## R2 Bucket Structure

### Bucket: `my-usagi-audio`

**Directory structure:**
```
/raw/{session_id}/{turn_id}.webm      # Original child audio
/tts/{hash}.mp3                        # TTS cached responses
/processed/{turn_id}.wav               # Processed audio (if needed)
```

**Naming conventions:**
- Use UUIDs for turn_id to avoid collisions
- TTS files use content hash for deduplication
- Include metadata in R2 custom metadata:
  - `session_id`
  - `turn_id`
  - `timestamp`
  - `content_type`

**Lifecycle policies:**
- Raw audio: Retain for 90 days
- TTS cache: Retain indefinitely (deduplicated)
- Processed audio: Delete after 30 days

## Durable Objects Storage

### ConversationSession DO

**KV Storage:**
```javascript
{
  "metadata": {
    "sessionId": "uuid",
    "startedAt": "timestamp",
    "childId": "optional"
  },
  "context": [
    {
      "turnId": "uuid",
      "childInput": "text",
      "rabbitResponse": "text",
      "timestamp": "timestamp"
    }
    // Last 5 turns only
  ],
  "vocabularySession": {
    "uniqueWords": ["word1", "word2"],
    "newWordsThisSession": ["word3"]
  }
}
```

## Queue Messages

### Vocabulary Analysis Queue

**Message format:**
```json
{
  "turnId": "uuid",
  "sessionId": "uuid",
  "text": "transcribed child input",
  "timestamp": "ISO8601"
}
```

**Consumer actions:**
1. Extract words using tokenizer
2. Compare against previous vocabulary
3. Update `vocabulary` table
4. Create highlights for new words
5. Update `analysis_jobs` table

### Daily Summary Queue (Cron trigger)

**Message format:**
```json
{
  "date": "YYYY-MM-DD",
  "childId": "optional"
}
```

**Consumer actions:**
1. Aggregate vocabulary growth
2. Generate usage statistics
3. Store in summary tables (future enhancement)

## Data Access Patterns

### Write patterns:
1. High-frequency: `conversation_turns` (every child interaction)
2. Medium-frequency: `vocabulary` (async queue processing)
3. Low-frequency: `sessions`, `highlights`

### Read patterns:
1. Hot path: Session lookup by ID (indexed)
2. Dashboard queries: Time-range scans with limits
3. Vocabulary analytics: Word frequency queries

### Optimization strategies:
- Use prepared statements for all D1 queries
- Cache TTS responses in R2 by content hash
- Batch vocabulary inserts in queue consumer
- Limit conversation context in DO to last 5 turns

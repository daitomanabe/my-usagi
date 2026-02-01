-- my-usagi schema refactor (v2)
-- Refactor to match specs: sessions, conversation_turns, vocabulary, highlights, analysis_jobs

PRAGMA foreign_keys = ON;

-- Drop old tables (data will be lost, OK for MVP)
DROP TABLE IF EXISTS reminders;
DROP TABLE IF EXISTS daily_summaries;
DROP TABLE IF EXISTS vocab_items;
DROP TABLE IF EXISTS tts_cache;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS profiles;

-- New schema per specs/data-model.md

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  child_id TEXT,
  started_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  turn_count INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  metadata TEXT
);

CREATE INDEX idx_sessions_child ON sessions(child_id);
CREATE INDEX idx_sessions_started ON sessions(started_at);
CREATE INDEX idx_sessions_active ON sessions(active);

CREATE TABLE conversation_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  child_input TEXT,
  rabbit_response TEXT,
  child_audio_r2_key TEXT,
  rabbit_audio_r2_key TEXT,
  duration_ms INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_turns_session ON conversation_turns(session_id);
CREATE INDEX idx_turns_timestamp ON conversation_turns(timestamp);

CREATE TABLE vocabulary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  word TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (turn_id) REFERENCES conversation_turns(id)
);

CREATE INDEX idx_vocabulary_session ON vocabulary(session_id);
CREATE INDEX idx_vocabulary_word ON vocabulary(word);
CREATE INDEX idx_vocabulary_first_seen ON vocabulary(first_seen_at);

CREATE TABLE highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  excerpt TEXT,
  FOREIGN KEY (turn_id) REFERENCES conversation_turns(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_highlights_session ON highlights(session_id);
CREATE INDEX idx_highlights_timestamp ON highlights(timestamp);
CREATE INDEX idx_highlights_type ON highlights(type);

CREATE TABLE analysis_jobs (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  result TEXT,
  FOREIGN KEY (turn_id) REFERENCES conversation_turns(id)
);

CREATE INDEX idx_jobs_status ON analysis_jobs(status);
CREATE INDEX idx_jobs_turn ON analysis_jobs(turn_id);

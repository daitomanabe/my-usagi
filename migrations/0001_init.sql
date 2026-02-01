-- my-usagi initial schema (v1)
-- Keep it simple: events table + vocab table + summaries. You will iterate.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  FOREIGN KEY(profile_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL,             -- "child" | "bunny" | "system"
  modality TEXT NOT NULL,           -- "text" | "audio"
  text TEXT,
  audio_r2_key TEXT,
  asr_provider TEXT,
  asr_confidence REAL,
  meta_json TEXT,
  FOREIGN KEY(profile_id) REFERENCES profiles(id),
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS tts_cache (
  id TEXT PRIMARY KEY,
  voice TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  audio_r2_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vocab_items (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  token TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  meta_json TEXT,
  FOREIGN KEY(profile_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS daily_summaries (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  day_ymd TEXT NOT NULL,            -- "YYYY-MM-DD"
  created_at INTEGER NOT NULL,
  summary_markdown TEXT NOT NULL,
  meta_json TEXT,
  UNIQUE(profile_id, day_ymd),
  FOREIGN KEY(profile_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL,               -- "bath" | "sleep" | "nursery" | etc
  cron TEXT NOT NULL,
  timezone TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  meta_json TEXT,
  FOREIGN KEY(profile_id) REFERENCES profiles(id)
);

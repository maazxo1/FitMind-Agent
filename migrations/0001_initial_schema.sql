-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  age INTEGER,
  weight_kg REAL,
  height_cm REAL,
  fitness_goal TEXT,
  activity_level TEXT,
  medical_notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  do_id TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_name TEXT,
  tokens_used INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Human Reviews (HITL)
CREATE TABLE IF NOT EXISTS human_reviews (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  agent_output TEXT NOT NULL,
  review_reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  reviewer_note TEXT,
  modified_output TEXT,
  reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Knowledge Sources (RAG)
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  source_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Agent Activity Logs
CREATE TABLE IF NOT EXISTS agent_activity_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  action TEXT NOT NULL,
  tool_name TEXT,
  input_summary TEXT,
  output_summary TEXT,
  tokens_used INTEGER,
  cost_usd REAL,
  latency_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Performance indexes: without these, every query is a full table scan
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_human_reviews_session_id ON human_reviews(session_id);
CREATE INDEX IF NOT EXISTS idx_human_reviews_status ON human_reviews(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_agent_activity_logs_session_id ON agent_activity_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_category ON knowledge_sources(category);

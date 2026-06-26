import { randomUUID } from 'crypto';

export interface User {
	id: string;
	name: string;
	email?: string;
	age?: number;
	weight_kg?: number;
	height_cm?: number;
	fitness_goal?: string;
	activity_level?: string;
	medical_notes?: string;
	created_at?: string;
}

export interface Session {
	id: string;
	user_id: string;
	do_id?: string;
	status: string;
	created_at?: string;
	updated_at?: string;
}

export interface Conversation {
	id: string;
	session_id: string;
	role: string;
	content: string;
	tool_name?: string;
	tokens_used?: number;
}

// Users
export async function createUser(db: D1Database, data: Omit<User, 'id' | 'created_at'>): Promise<User> {
	const id = randomUUID();
	await db.prepare(
		`INSERT INTO users (id, name, email, age, weight_kg, height_cm, fitness_goal, activity_level, medical_notes)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).bind(id, data.name, data.email ?? null, data.age ?? null, data.weight_kg ?? null,
		data.height_cm ?? null, data.fitness_goal ?? null, data.activity_level ?? null,
		data.medical_notes ?? null).run();
	return { id, ...data };
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
	return db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<User>();
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
	return db.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<User>();
}

// Sessions
export async function createSession(db: D1Database, userId: string): Promise<Session> {
	const id = randomUUID();
	await db.prepare(
		`INSERT INTO sessions (id, user_id, status) VALUES (?, ?, 'active')`
	).bind(id, userId).run();
	return { id, user_id: userId, status: 'active' };
}

export async function getSession(db: D1Database, id: string): Promise<Session | null> {
	return db.prepare(`SELECT * FROM sessions WHERE id = ?`).bind(id).first<Session>();
}

export async function getUserSessions(db: D1Database, userId: string): Promise<Session[]> {
	const result = await db.prepare(
		`SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC`
	).bind(userId).all<Session>();
	return result.results;
}

export async function getActiveSession(db: D1Database, userId: string): Promise<Session | null> {
	return db.prepare(
		`SELECT * FROM sessions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`
	).bind(userId).first<Session>();
}

// Conversations
export async function saveMessage(db: D1Database, data: Omit<Conversation, 'id'>): Promise<void> {
	const id = randomUUID();
	await db.prepare(
		`INSERT INTO conversations (id, session_id, role, content, tool_name, tokens_used)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).bind(id, data.session_id, data.role, data.content, data.tool_name ?? null, data.tokens_used ?? null).run();
}

export async function getConversationHistory(db: D1Database, sessionId: string): Promise<Conversation[]> {
	const result = await db.prepare(
		`SELECT * FROM conversations WHERE session_id = ? ORDER BY created_at ASC`
	).bind(sessionId).all<Conversation>();
	return result.results;
}

// Fetch the most recent N messages across all sessions for a user (for memory recovery)
export async function getRecentHistory(db: D1Database, userId: string, limit = 20): Promise<{ role: string; content: string; created_at: string }[]> {
	const result = await db.prepare(
		`SELECT c.role, c.content, c.created_at
		 FROM conversations c
		 JOIN sessions s ON c.session_id = s.id
		 WHERE s.user_id = ?
		 ORDER BY c.created_at DESC
		 LIMIT ?`
	).bind(userId, limit).all<{ role: string; content: string; created_at: string }>();
	return result.results.reverse(); // oldest first
}

export async function clearConversationHistory(db: D1Database, sessionId: string): Promise<void> {
	await db.prepare(`DELETE FROM conversations WHERE session_id = ?`).bind(sessionId).run();
}

// Activity Logs
export async function logActivity(db: D1Database, data: {
	session_id?: string;
	action: string;
	tool_name?: string;
	input_summary?: string;
	output_summary?: string;
	tokens_used?: number;
	cost_usd?: number;
	latency_ms?: number;
}): Promise<void> {
	const id = randomUUID();
	await db.prepare(
		`INSERT INTO agent_activity_logs (id, session_id, action, tool_name, input_summary, output_summary, tokens_used, cost_usd, latency_ms)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).bind(id, data.session_id ?? null, data.action, data.tool_name ?? null,
		data.input_summary ?? null, data.output_summary ?? null,
		data.tokens_used ?? null, data.cost_usd ?? null, data.latency_ms ?? null).run();
}

// Human Reviews
export async function createHumanReview(db: D1Database, data: {
	session_id: string;
	user_id: string;
	agent_output: string;
	review_reason: string;
}): Promise<string> {
	const id = randomUUID();
	await db.prepare(
		`INSERT INTO human_reviews (id, session_id, user_id, agent_output, review_reason)
		 VALUES (?, ?, ?, ?, ?)`
	).bind(id, data.session_id, data.user_id, data.agent_output, data.review_reason).run();
	return id;
}

export async function getPendingReviews(db: D1Database, page = 1, limit = 50) {
	const safeLimit = Math.min(100, Math.max(1, limit));
	const offset = (Math.max(1, page) - 1) * safeLimit;
	const result = await db.prepare(
		`SELECT hr.*, u.name as user_name, u.fitness_goal
		 FROM human_reviews hr
		 JOIN users u ON hr.user_id = u.id
		 ORDER BY hr.status ASC, hr.created_at ASC
		 LIMIT ? OFFSET ?`
	).bind(safeLimit, offset).all();
	return result.results;
}

export async function updateReview(db: D1Database, id: string, data: {
	status: 'approved' | 'rejected' | 'modified';
	reviewer_note?: string;
	modified_output?: string;
}): Promise<void> {
	await db.prepare(
		`UPDATE human_reviews SET status = ?, reviewer_note = ?, modified_output = ?, reviewed_at = datetime('now')
		 WHERE id = ?`
	).bind(data.status, data.reviewer_note ?? null, data.modified_output ?? null, id).run();
}

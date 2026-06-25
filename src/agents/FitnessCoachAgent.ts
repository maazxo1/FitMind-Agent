import { Agent } from 'agents';
import type { Connection, WSMessage } from 'agents';
import { retrieveContext } from '../lib/rag';
import { createHumanReview, saveMessage, getRecentHistory, clearConversationHistory } from '../lib/db';

export interface FitnessCoachState {
	userId: string;
	sessionId: string;
	userName: string;
	age: number;
	weight_kg: number;
	height_cm: number;
	fitnessGoal: string;
	activityLevel: string;
	medicalNotes: string;
	conversationHistory: GeminiMessage[];
	agentNotes: string[]; // long-term facts the agent learns about the user
}

interface GeminiMessage {
	role: 'user' | 'model';
	parts: Array<{ text?: string; functionCall?: any; functionResponse?: any }>;
}

// Only route to WorkoutPlannerAgent when the user explicitly wants a plan/programme generated.
// General fitness questions ("best cardio?", "how many reps?") go to streaming general chat.
const WORKOUT_KEYWORDS = /\b(create|make|build|give me|generate|write|design|need|want|give)\b.{0,40}\b(workout|training|exercise|gym|plan|programme|program|routine|schedule)\b|\b(workout|training|exercise|gym)\b.{0,20}\b(plan|programme|program|routine|schedule)\b/i;

// High-confidence off-topic detector — caught BEFORE calling Gemini (zero LLM cost).
// Covers programming languages, explicit code requests, and dev tooling commands.
const OFF_TOPIC = /\b(python|javascript|typescript|java(?!\s+burn|\s+tea|\s+ring|\s+chip)|\bc\+\+\b|\bc#\b|golang|ruby(?!\s+red|\s+ring)|\brunst\b|php|swift(?!\s+lift|\s+run)|kotlin|html(?!\s+intake)|css(?!\s+weight|\s+loss)|\bnodejs\b|django|flask|tensorflow|pytorch|pandas|numpy|matplotlib|scikit)\b|\b(write|make|create|build|generate|show|give me)\b.{0,30}\b(code|function|class|script|algorithm|program(?!me|ming plan|s (for|to)|ming for))\b|\bhello world\b|\bsyntax error\b|\b(npm|pip|yarn|cargo)\s+install\b|\bstackoverflow\b|\bdebug\s+(my\s+)?(code|error|bug)\b/i;

const GENERAL_PROMPT = (s: FitnessCoachState, ragContext: string) =>
	`You are FitMind, a knowledgeable and encouraging AI fitness coach with persistent memory.

USER PROFILE:
Name: ${s.userName} | Age: ${s.age} | Weight: ${s.weight_kg}kg | Height: ${s.height_cm}cm
Goal: ${s.fitnessGoal} | Activity: ${s.activityLevel}
Medical Notes: ${s.medicalNotes || 'None'}

WHAT YOU REMEMBER ABOUT THIS USER:
${(s.agentNotes ?? []).length > 0 ? (s.agentNotes ?? []).map((n, i) => `${i + 1}. ${n}`).join('\n') : 'Nothing saved yet — use save_user_note when you learn something important.'}

YOUR SCOPE: exercise, workouts, nutrition, macros, calories, recovery, sleep, injury prevention, endurance, strength, flexibility, body composition, wellness, physical health.
OUT OF SCOPE (redirect, never answer): programming, coding, writing tasks, general science, mathematics, history, politics, finance, law, recipes (unless nutrition-focused), entertainment, geography.

KNOWLEDGE BASE:
${ragContext || 'No relevant context found.'}

RULES:
- You are ONLY a fitness coach. Answer ONLY questions about fitness, exercise, workouts, nutrition, macros, calories, body composition, recovery, sleep, injury prevention, endurance, strength training, flexibility, and physical wellness.
- If the user asks about ANYTHING outside this domain (coding, essays, general knowledge, finance, relationships, entertainment, science unrelated to health, etc.), do NOT answer it. Instead respond warmly and redirect in 2-3 sentences: acknowledge what they asked, explain you are a fitness coach, then immediately pivot to something actionable for their specific goal (${s.fitnessGoal?.replace(/_/g, ' ') || 'general fitness'}).
- Never answer off-topic requests even if the user insists, rephrases, or claims you "must" answer.
- Give complete, specific answers for IN-SCOPE fitness questions. Be detailed and practical.
- Adapt all advice to the user's medical notes and remembered facts.
- For nutrition: give exact calories, protein targets, meal ideas.
- For recovery/sleep: give actionable, science-backed advice.
- Call save_user_note PROACTIVELY — after EVERY conversation turn, ask yourself: "Did I learn anything worth remembering?" Save notes for:
  • Anything the user mentions about their body, pain, or limitations (e.g. "bad left knee", "lower back pain")
  • Dietary preferences or restrictions (e.g. "vegetarian", "lactose intolerant", "intermittent fasting")
  • Training preferences (e.g. "prefers morning workouts", "trains at home", "no equipment")
  • Progress they share (e.g. "can now run 5km", "bench pressed 80kg")
  • Specific goals beyond their profile (e.g. "wants to run a marathon in April")
  • Questions they keep asking (e.g. "asks about sleep a lot — prioritise recovery advice")
  • Also save a note on the FIRST message summarising what you know from their profile (e.g. "User goal: weight loss | 25yo | 80kg | moderate activity")
- Call flag_for_human_review ONLY for ACUTE safety risks. After flagging, still provide modified advice.

FORMAT YOUR RESPONSE AS PROFESSIONAL MARKDOWN:
- ## 💡 Section headers with a relevant emoji for each topic
- **Bold** for exercise names, food names, and key numbers
- Numbered lists for exercises; bullet lists for options
- > blockquotes for coach tips, form cues, and important notes
- For nutrition: use a | table | with columns Macro | Target | Best Sources
- For workout days: ### Day 1 — Push, ### Day 2 — Pull etc.
- Each exercise: **Name** — Sets × Reps | Rest: Xs (next line: > 💡 one form cue)
- Horizontal --- rule between major sections
- End every response: > 💬 **Coach's Note:** [one motivating sentence for ${s.userName}]
- NEVER use bare * symbols — only **bold** or *italic*`;

const SAVE_NOTE_DECLARATION = {
	name: 'save_user_note',
	description: 'Save an important fact about the user to long-term memory — use for preferences, injuries, dietary restrictions, goals, or anything that should be remembered across all future conversations',
	parameters: {
		type: 'OBJECT',
		properties: {
			note: { type: 'STRING', description: 'The fact to remember, written as a short clear statement e.g. "User is vegetarian", "User has a knee injury — avoid high-impact", "User prefers morning workouts"' },
		},
		required: ['note'],
	},
};

const FLAG_DECLARATION = {
	name: 'flag_for_human_review',
	description: 'Flag for certified human trainer — only for acute safety risks or extreme plans',
	parameters: {
		type: 'OBJECT',
		properties: {
			reason: { type: 'STRING', description: 'Why this needs human review' },
			planned_response: { type: 'STRING', description: 'What you were going to tell the user' },
		},
		required: ['reason', 'planned_response'],
	},
};

const CALORIE_DECLARATION = {
	name: 'calculate_calories',
	description: 'Calculate daily calorie needs and protein targets for this user',
	parameters: {
		type: 'OBJECT',
		properties: {
			gender: { type: 'STRING', description: 'male or female' },
			goal: { type: 'STRING', description: 'weight_loss, maintenance, or muscle_gain' },
		},
		required: ['gender', 'goal'],
	},
};

const BMI_DECLARATION = {
	name: 'calculate_bmi',
	description: 'Calculate BMI from weight and height',
	parameters: {
		type: 'OBJECT',
		properties: {
			weight_kg: { type: 'NUMBER' },
			height_cm: { type: 'NUMBER' },
		},
		required: ['weight_kg', 'height_cm'],
	},
};

export class FitnessCoachAgent extends Agent<Env, FitnessCoachState> {
	initialState: FitnessCoachState = {
		userId: '', sessionId: '', userName: 'User', age: 0,
		weight_kg: 0, height_cm: 0, fitnessGoal: 'general fitness',
		activityLevel: 'moderate', medicalNotes: '', conversationHistory: [], agentNotes: [],
	};

	// Serialize concurrent chat messages so setState calls never race
	private chatQueue: Promise<void> = Promise.resolve();

	// On DO startup: recover conversation history from D1 if state is empty
	async onStart(): Promise<void> {
		// Heal state from older DO snapshots that predate new fields
		const needsMigration = !Array.isArray(this.state.conversationHistory) || !Array.isArray(this.state.agentNotes);
		if (needsMigration) {
			this.setState({
				...this.state,
				conversationHistory: Array.isArray(this.state.conversationHistory) ? this.state.conversationHistory : [],
				agentNotes: Array.isArray(this.state.agentNotes) ? this.state.agentNotes : [],
			});
		}

		// Recover conversation history from D1 when DO state is empty
		if (this.state.userId && !(this.state.conversationHistory ?? []).length) {
			try {
				const rows = await getRecentHistory(this.env.fitness_coach_db, this.state.userId, 20);
				if (rows.length > 0) {
					const recovered: GeminiMessage[] = rows.map(r => ({
						role: r.role === 'assistant' ? 'model' as const : 'user' as const,
						parts: [{ text: r.content }],
					}));
					this.setState({ ...this.state, conversationHistory: recovered });
				}
			} catch (err) {
				console.warn('[FitMind] Failed to recover conversation history from D1:', err);
			}
		}
	}

	async onMessage(connection: Connection, message: WSMessage): Promise<void> {
		try {
			const data = JSON.parse(typeof message === 'string' ? message : message.toString());

			if (data.type === 'init') {
				const p = data.profile ?? {};
				if (typeof p.userId !== 'string' || !p.userId) return;
				if (p.age !== undefined && (typeof p.age !== 'number' || p.age < 5 || p.age > 150)) return;
				if (p.weight_kg !== undefined && (typeof p.weight_kg !== 'number' || p.weight_kg <= 0 || p.weight_kg > 700)) return;
				if (p.height_cm !== undefined && (typeof p.height_cm !== 'number' || p.height_cm <= 0 || p.height_cm > 300)) return;
				this.setState({ ...this.state, ...p });
				let history: Array<{ role: string; content: string; created_at: string }> = [];
				try {
					if (data.profile.userId) {
						history = await getRecentHistory(this.env.fitness_coach_db, data.profile.userId, 30);
					}
				} catch { /* non-fatal — proceed without history */ }
				connection.send(JSON.stringify({
					type: 'ready',
					notes: this.state.agentNotes ?? [],
					history,
				}));
				return;
			}

			if (data.type === 'chat') {
				const userMessage = (data.message ?? '').trim();
				if (!userMessage) return;
				if (userMessage.length > 10000) {
					connection.send(JSON.stringify({ type: 'message', role: 'assistant', content: 'Your message is too long. Please keep it under 10,000 characters.' }));
					return;
				}
				this.chatQueue = this.chatQueue
					.then(() => this.handleChat(connection, userMessage))
					.catch(() => {});
				await this.chatQueue;
				return;
			}

			if (data.type === 'get_memory') {
				connection.send(JSON.stringify({ type: 'memory', notes: this.state.agentNotes ?? [] }));
				return;
			}

			if (data.type === 'delete_memory') {
				const notes = [...(this.state.agentNotes ?? [])];
				if (typeof data.index === 'number' && data.index >= 0 && data.index < notes.length) {
					notes.splice(data.index, 1);
					this.setState({ ...this.state, agentNotes: notes });
				}
				connection.send(JSON.stringify({ type: 'memory', notes }));
				return;
			}

			if (data.type === 'clear_memory') {
				this.setState({ ...this.state, agentNotes: [] });
				connection.send(JSON.stringify({ type: 'memory', notes: [] }));
				return;
			}

			if (data.type === 'clear_chat') {
				this.setState({ ...this.state, conversationHistory: [] });
				if (this.state.userId) {
					try {
						await clearConversationHistory(this.env.fitness_coach_db, this.state.userId);
					} catch (err) {
						console.warn('[FitMind] Failed to clear D1 conversation history:', err);
					}
				}
				connection.send(JSON.stringify({ type: 'chat_cleared' }));
				return;
			}
		} catch (err: any) {
			console.error('Agent error:', err);
			connection.send(JSON.stringify({
				type: 'message', role: 'assistant',
				content: `Sorry, I ran into an error: ${err?.message ?? 'Unknown error'}. Please try again.`,
			}));
		}
	}

	private buildRedirect(): string {
		const goalLabel = (this.state.fitnessGoal ?? '').replace(/_/g, ' ') || 'general fitness';
		const name = this.state.userName || 'there';
		return `Hey ${name}! I'm FitMind — your personal AI fitness coach. That's a bit outside my lane, but **${goalLabel}** is exactly what I'm built for!\n\n> 💬 **Coach's Note:** Ask me about your workouts, nutrition targets, recovery strategies, or anything else on your ${goalLabel} journey. I'm ready when you are!`;
	}

	private async handleChat(connection: Connection, userMessage: string): Promise<void> {
		// Layer 2: Intercept obvious off-topic requests without calling Gemini
		if (OFF_TOPIC.test(userMessage)) {
			connection.send(JSON.stringify({ type: 'message', role: 'assistant', content: this.buildRedirect() }));
			return;
		}

		connection.send(JSON.stringify({ type: 'status', status: 'thinking' }));
		try {
			const ragContext = await retrieveContext(this.env, userMessage);
			const isWorkoutQuery = WORKOUT_KEYWORDS.test(userMessage);

			let finalText: string;

			if (isWorkoutQuery) {
				connection.send(JSON.stringify({ type: 'status', status: 'thinking', agent: 'workout-planner' }));
				finalText = await this.callWorkoutAgent(userMessage, ragContext);
				// Stream word-by-word so the client renders progressively (same as general chat)
				for (const token of finalText.split(/(\s+)/)) {
					if (token) connection.send(JSON.stringify({ type: 'chunk', content: token }));
				}
				connection.send(JSON.stringify({ type: 'message_done' }));
			} else {
				// General chat streams token-by-token directly to the WebSocket
				finalText = await this.runGeneralChat(userMessage, ragContext, connection);
			}

			const history = [
				...(this.state.conversationHistory ?? [] as GeminiMessage[]),
				{ role: 'user' as const, parts: [{ text: userMessage }] },
				{ role: 'model' as const, parts: [{ text: finalText }] },
			];

			// Persist to D1 before updating DO state so both sources stay in sync
			if (this.state.sessionId) {
				await Promise.allSettled([
					saveMessage(this.env.fitness_coach_db, { session_id: this.state.sessionId, role: 'user', content: userMessage }),
					saveMessage(this.env.fitness_coach_db, { session_id: this.state.sessionId, role: 'assistant', content: finalText }),
				]);
			}
			this.setState({ ...this.state, conversationHistory: history.slice(-20) });
		} catch (err: any) {
			console.error('handleChat error:', err);
			connection.send(JSON.stringify({ type: 'message_done' }));
			connection.send(JSON.stringify({
				type: 'message', role: 'assistant',
				content: err?.message ?? 'Something went wrong. Please try again.',
			}));
		}
	}

	// Call WorkoutPlannerAgent DO via HTTP
	private async callWorkoutAgent(query: string, ragContext: string): Promise<string> {
		const id = this.env.WorkoutPlannerAgent.idFromName(this.state.userId);
		const stub = this.env.WorkoutPlannerAgent.get(id);
		const res = await stub.fetch('http://internal/plan', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Internal-Key': this.env.ADMIN_SECRET },
			body: JSON.stringify({
				profile: this.state,
				query,
				ragContext,
				conversationHistory: (this.state.conversationHistory ?? []).slice(-6),
				agentNotes: this.state.agentNotes,
			}),
		});
		const data = await res.json<any>();
		if (!res.ok || data.error) {
			const msg: string = data.error ?? 'Workout agent failed';
			throw new Error(
				msg.includes('429')
					? 'The AI is temporarily rate-limited. Please wait 30 seconds and try again.'
					: msg
			);
		}
		return data.plan;
	}

	// Stream Gemini SSE response — sends chunks to connection, returns full text + any tool calls
	private async streamGemini(
		body: object,
		connection: Connection,
	): Promise<{ text: string; calls: Array<{ name: string; args: any }>; rawParts: any[] }> {
		const url = (this.env.CF_ACCOUNT_ID && this.env.AI_GATEWAY_NAME)
			? `https://gateway.ai.cloudflare.com/v1/${this.env.CF_ACCOUNT_ID}/${this.env.AI_GATEWAY_NAME}/google-ai-studio/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse`
			: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse`;
		const opts: RequestInit = {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.env.GEMINI_API_KEY },
			body: JSON.stringify(body),
		};

		const RETRYABLE = new Set([429, 500, 503]);
		let res: Response = await fetch(url, opts);
		for (let attempt = 0; RETRYABLE.has(res.status) && attempt < 2; attempt++) {
			await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 3000) + Math.random() * 500));
			res = await fetch(url, opts);
		}

		if (!res.ok) {
			const body = await res.text().catch(() => '');
			console.error(`Gemini streamGenerateContent error ${res.status}:`, body);
			const err: any = JSON.parse(body || '{}');
			const msg = err?.error?.message ?? `LLM failed: ${res.status}`;
			throw new Error(
				res.status === 429
					? 'The AI is temporarily rate-limited. Please wait 30 seconds and try again.'
					: (res.status === 500 || res.status === 503)
						? 'The AI is under high demand. Please try again in a moment.'
						: msg
			);
		}

		if (!res.body) throw new Error('LLM returned an empty response body');
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let sseBuffer = '';
		let fullText = '';
		const calls: Array<{ name: string; args: any }> = [];
		const rawParts: any[] = [];

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			sseBuffer += decoder.decode(value, { stream: true });
			const lines = sseBuffer.split('\n');
			sseBuffer = lines.pop() ?? '';

			for (const line of lines) {
				if (!line.startsWith('data: ')) continue;
				const json = line.slice(6).trim();
				if (!json || json === '[DONE]') continue;
				try {
					const chunk = JSON.parse(json);
					const parts: any[] = chunk.candidates?.[0]?.content?.parts ?? [];
					for (const part of parts) {
						rawParts.push(part);
						if (part.text && !part.thought) {
							fullText += part.text;
							// Only stream text to client if no tool calls in this turn yet
							if (calls.length === 0) {
								connection.send(JSON.stringify({ type: 'chunk', content: part.text }));
							}
						}
						if (part.functionCall) {
							calls.push({ name: part.functionCall.name, args: part.functionCall.args });
						}
					}
				} catch { /* ignore malformed SSE chunks */ }
			}
		}

		return { text: fullText, calls, rawParts };
	}

	// Fallback: stream via Cloudflare Workers AI when Gemini is rate-limited
	private async streamWorkersAI(
		systemPrompt: string,
		contents: GeminiMessage[],
		connection: Connection,
	): Promise<string> {
		const messages = [
			{ role: 'system', content: systemPrompt },
			...contents.map(m => ({
				role: m.role === 'model' ? 'assistant' : 'user',
				content: m.parts.map((p: any) => p.text ?? '').join(''),
			})),
		];
		const stream = await (this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
			messages, stream: true,
		}) as Promise<ReadableStream>);
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let fullText = '';
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			for (const line of decoder.decode(value, { stream: true }).split('\n')) {
				if (!line.startsWith('data: ')) continue;
				const json = line.slice(6).trim();
				if (!json || json === '[DONE]') continue;
				try {
					const text = JSON.parse(json).response ?? '';
					if (text) { fullText += text; connection.send(JSON.stringify({ type: 'chunk', content: text })); }
				} catch { /* ignore malformed */ }
			}
		}
		connection.send(JSON.stringify({ type: 'message_done' }));
		return fullText;
	}

	// General fitness chat — streams response tokens directly to WebSocket
	private async runGeneralChat(userMessage: string, ragContext: string, connection: Connection): Promise<string> {
		const contents: GeminiMessage[] = [
			...(this.state.conversationHistory ?? [] as GeminiMessage[]),
			{ role: 'user', parts: [{ text: userMessage }] },
		];
		const sysBody = {
			system_instruction: { parts: [{ text: GENERAL_PROMPT(this.state, ragContext) }] },
			tools: [{ functionDeclarations: [SAVE_NOTE_DECLARATION, FLAG_DECLARATION, CALORIE_DECLARATION, BMI_DECLARATION] }],
			generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
		};

		for (let i = 0; i < 5; i++) {
			let result: { text: string; calls: Array<{ name: string; args: any }>; rawParts: any[] };
			try {
				result = await this.streamGemini({ ...sysBody, contents }, connection);
			} catch (err: any) {
				if (i === 0 && (err.message?.includes('rate-limited') || err.message?.includes('high demand'))) {
					// No chunks sent yet — transparently fall back to Workers AI
					connection.send(JSON.stringify({ type: 'status', status: 'thinking', agent: 'backup' }));
					return await this.streamWorkersAI(GENERAL_PROMPT(this.state, ragContext), contents, connection);
				}
				throw err;
			}
			const { text, calls, rawParts } = result;

			if (calls.length === 0) {
				// Final text turn — already streamed to client, signal completion
				connection.send(JSON.stringify({ type: 'message_done' }));
				return text;
			}

			// Tool call turn — execute tools serially to prevent concurrent setState races
			contents.push({ role: 'model', parts: rawParts });
			const results: any[] = [];
			for (const fc of calls) {
				results.push({
					functionResponse: {
						name: fc.name,
						response: { result: await this.executeTool(fc.name, fc.args).catch((e: any) => `Tool error: ${e?.message ?? 'unknown'}`) },
					},
				});
			}
			contents.push({ role: 'user', parts: results });
		}

		connection.send(JSON.stringify({ type: 'message_done' }));
		return 'I had trouble processing your request. Please try again.';
	}

	private async executeTool(name: string, args: any): Promise<string> {
		const { state, env } = this;

		if (name === 'save_user_note') {
			const note = String(args.note ?? '').trim();
			if (!note) return 'Note was empty, nothing saved.';
			const notes = [...(state.agentNotes ?? [])];
			if (!notes.includes(note)) {
				notes.push(note);
				const updated = notes.slice(-30); // keep up to 30 facts
				this.setState({ ...state, agentNotes: updated });
				try { this.broadcast(JSON.stringify({ type: 'memory', notes: updated })); } catch { /* clients disconnected */ }
			}
			return `Remembered: "${note}"`;
		}

		if (name === 'calculate_bmi') {
			const bmi = args.weight_kg / Math.pow(args.height_cm / 100, 2);
			const cat = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal weight' : bmi < 30 ? 'Overweight' : 'Obese';
			return `BMI: ${bmi.toFixed(1)} (${cat}).`;
		}

		if (name === 'calculate_calories') {
			const { weight_kg, height_cm, age, activityLevel } = state;
			if (!weight_kg || !height_cm || !age) return 'User profile incomplete.';
			const bmr = args.gender === 'male'
				? 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
				: 10 * weight_kg + 6.25 * height_cm - 5 * age - 161;
			const mult: Record<string, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, very_active: 1.725 };
			const tdee = Math.round(bmr * (mult[activityLevel] ?? 1.55));
			const targets: Record<string, number> = { weight_loss: tdee - 400, maintenance: tdee, muscle_gain: tdee + 250 };
			return `BMR: ${Math.round(bmr)} kcal | TDEE: ${tdee} kcal | Target (${args.goal}): ${targets[args.goal]} kcal/day | Protein: ${Math.round(weight_kg * 1.8)}g/day`;
		}

		if (name === 'flag_for_human_review') {
			if (state.sessionId && state.userId) {
				try {
					await createHumanReview(env.fitness_coach_db, {
						session_id: state.sessionId,
						user_id: state.userId,
						agent_output: args.planned_response,
						review_reason: args.reason,
					});
				} catch (err) {
					console.error('Failed to persist human review:', err);
				}
			}
			return `Flagged for human trainer review. Reason: ${args.reason}`;
		}

		return `Unknown tool: ${name}`;
	}
}

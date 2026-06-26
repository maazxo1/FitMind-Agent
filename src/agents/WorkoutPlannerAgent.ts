import { Agent } from 'agents';

interface GeminiMessage {
	role: 'user' | 'model';
	parts: Array<{ text?: string }>;
}

interface WorkoutRequest {
	profile: {
		userName: string;
		age: number;
		weight_kg: number;
		height_cm: number;
		fitnessGoal: string;
		activityLevel: string;
		medicalNotes: string;
	};
	query: string;
	ragContext: string;
	conversationHistory?: GeminiMessage[];
	agentNotes?: string[];
}

const SYSTEM_PROMPT = (req: WorkoutRequest) => `You are an elite workout programmer and exercise scientist specialising in creating highly specific, personalised training plans.

USER PROFILE:
Name: ${req.profile.userName} | Age: ${req.profile.age} | Weight: ${req.profile.weight_kg}kg | Height: ${req.profile.height_cm}cm
Goal: ${req.profile.fitnessGoal} | Activity Level: ${req.profile.activityLevel}
Medical Notes: ${req.profile.medicalNotes || 'None'}

REMEMBERED FACTS ABOUT THIS USER:
${req.agentNotes && req.agentNotes.length > 0 ? req.agentNotes.map((n, i) => `${i + 1}. ${n}`).join('\n') : 'None yet.'}

KNOWLEDGE BASE:
${req.ragContext || 'No specific context retrieved.'}

YOUR JOB:
- Create a detailed, specific workout plan tailored to the user's goal and medical notes
- If medical notes exist, modify exercises accordingly (e.g. lower back pain → core stability over heavy deadlifts)
- Always include: exercise names, sets × reps, rest periods

FORMAT AS PROFESSIONAL MARKDOWN:
- ## 💪 Section header at the top (e.g. ## 💪 4-Week Strength Plan)
- ### Day 1 — Push / Day 2 — Pull etc. for each training day
- Each exercise on its own block:
  **1. Exercise Name** — Sets × Reps | Rest: 60s
  > 💡 One-line form cue
- --- horizontal rule between days
- | table | for weekly schedule overview if plan spans multiple days
- **Bold** all exercise names and numbers
- End with: > 💬 **Coach's Note:** [one motivating sentence for the user]
- NEVER use bare * bullets — use numbered lists or - dashes only`;

const FUNCTION_DECLARATIONS = [
	{
		name: 'search_exercises',
		description: 'Search exercises by body part. Use EXACT names: back, cardio, chest, lower arms, lower legs, neck, shoulders, upper arms, upper legs, waist',
		parameters: {
			type: 'OBJECT',
			properties: {
				body_part: { type: 'STRING', description: 'One of: back, cardio, chest, lower arms, lower legs, neck, shoulders, upper arms, upper legs, waist' },
			},
			required: ['body_part'],
		},
	},
	{
		name: 'get_weather',
		description: 'Get current weather for a city — use when user asks about outdoor training conditions',
		parameters: {
			type: 'OBJECT',
			properties: { city: { type: 'STRING', description: 'City name' } },
			required: ['city'],
		},
	},
];

export class WorkoutPlannerAgent extends Agent<Env, {}> {
	initialState = {};

	override async fetch(request: Request): Promise<Response> {
		if (request.headers.get('Upgrade') === 'websocket') {
			return super.fetch(request);
		}

		if (request.method === 'POST') {
			const expectedKey = this.env.INTERNAL_KEY || this.env.ADMIN_SECRET;
			if (request.headers.get('X-Internal-Key') !== expectedKey) {
				return Response.json({ error: 'Unauthorized' }, { status: 401 });
			}
			try {
				const body = await request.json<WorkoutRequest>();
				const plan = await this.generatePlan(body);
				return Response.json({ plan });
			} catch (err: any) {
				return Response.json({ error: err.message }, { status: 500 });
			}
		}

		return super.fetch(request);
	}

	private async gemini(url: string, body: object): Promise<Response> {
		const opts: RequestInit = {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.env.GEMINI_API_KEY },
			body: JSON.stringify(body),
		};
		// 429 is NOT retried — fall through immediately so caller can switch to Workers AI
		const RETRYABLE = new Set([500, 503]);
		for (let attempt = 0; attempt < 2; attempt++) {
			const res = await fetch(url, opts);
			if (!RETRYABLE.has(res.status)) return res;
			await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 3000) + Math.random() * 500));
		}
		return fetch(url, opts); // final attempt, let caller handle the status
	}

	private async generatePlan(req: WorkoutRequest): Promise<string> {
		const url = (this.env.CF_ACCOUNT_ID && this.env.AI_GATEWAY_NAME)
			? `https://gateway.ai.cloudflare.com/v1/${this.env.CF_ACCOUNT_ID}/${this.env.AI_GATEWAY_NAME}/google-ai-studio/v1beta/models/gemini-2.5-flash:generateContent`
			: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;
		const contents: any[] = [
			...(req.conversationHistory ?? []),
			{ role: 'user', parts: [{ text: req.query }] },
		];

		for (let i = 0; i < 4; i++) {
			const res = await this.gemini(url, {
				system_instruction: { parts: [{ text: SYSTEM_PROMPT(req) }] },
				contents,
				tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
				generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
			});

			if (!res.ok) {
				if (res.status === 429) return this.generatePlanWithWorkersAI(req);
				throw new Error(
					(res.status === 500 || res.status === 503)
						? 'The AI is under high demand. Please try again in a moment.'
						: `LLM error: ${res.status}`
				);
			}

			const data: any = await res.json();
			const parts = data?.candidates?.[0]?.content?.parts ?? [];
			const calls = parts.filter((p: any) => p.functionCall);

			if (calls.length === 0) {
				return parts.filter((p: any) => !p.thought).map((p: any) => p.text ?? '').join('').trim();
			}

			contents.push({ role: 'model', parts });
			const results = await Promise.all(
				calls.map(async (p: any) => ({
					functionResponse: {
						name: p.functionCall.name,
						response: { result: await this.executeTool(p.functionCall.name, p.functionCall.args) },
					},
				}))
			);
			contents.push({ role: 'user', parts: results });
		}

		return 'Could not generate workout plan. Please try again.';
	}

	private async generatePlanWithWorkersAI(req: WorkoutRequest): Promise<string> {
		const prompt = `${SYSTEM_PROMPT(req)}\n\nGenerate a detailed workout plan for: ${req.query}`;
		try {
			const res = await (this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
				messages: [{ role: 'user', content: prompt }],
				max_tokens: 4096,
			}) as Promise<{ response: string }>);
			return res.response?.trim() || 'Could not generate a plan right now. Please try again.';
		} catch {
			throw new Error('Both AI models are temporarily unavailable. Please try again in a moment.');
		}
	}

	private async executeTool(name: string, args: any): Promise<string> {
		if (name === 'search_exercises') {
			const bodyPart = encodeURIComponent(args.body_part ?? 'chest');
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), 8000);
			try {
				const res = await fetch(`https://exercisedb.p.rapidapi.com/exercises/bodyPart/${bodyPart}?limit=6`, {
					headers: { 'X-RapidAPI-Key': this.env.RAPIDAPI_KEY, 'X-RapidAPI-Host': 'exercisedb.p.rapidapi.com' },
					signal: ctrl.signal,
				});
				if (!res.ok) return `Exercise API error (${res.status})`;
				const d: any = await res.json();
				if (!Array.isArray(d) || d.length === 0) return `No exercises found for: ${bodyPart}`;
				return d.slice(0, 6).map((e: any) => `• ${e.name} — equipment: ${e.equipment}, target: ${e.target}`).join('\n');
			} catch (err: any) {
				return err.name === 'AbortError' ? 'Exercise API timed out.' : `Exercise API error: ${err.message}`;
			} finally {
				clearTimeout(timer);
			}
		}

		if (name === 'get_weather') {
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), 8000);
			try {
				const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(args.city ?? '')}&appid=${this.env.OPENWEATHER_API_KEY}&units=metric`, { signal: ctrl.signal });
				if (!res.ok) return `Could not get weather for ${args.city}`;
				const d: any = await res.json();
				return `${d.name}: ${d.main.temp}°C, ${d.weather[0].description}. Feels like ${d.main.feels_like}°C.`;
			} catch (err: any) {
				return err.name === 'AbortError' ? 'Weather API timed out.' : `Could not get weather for ${args.city}`;
			} finally {
				clearTimeout(timer);
			}
		}

		return `Unknown tool: ${name}`;
	}
}

import { routeAgentRequest } from 'agents';
import { FitnessCoachAgent } from './agents/FitnessCoachAgent';
import { WorkoutPlannerAgent } from './agents/WorkoutPlannerAgent';
import { createUser, getUserById, getUserByEmail, createSession, getUserSessions, getPendingReviews, updateReview } from './lib/db';
import { ingestDocument } from './lib/rag';

export { FitnessCoachAgent, WorkoutPlannerAgent };

function withSecurityHeaders(res: Response): Response {
	const h = new Headers(res.headers);
	h.set('X-Content-Type-Options', 'nosniff');
	h.set('X-Frame-Options', 'DENY');
	h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const method = request.method;

		// Health check
		if (url.pathname === '/health') {
			return Response.json({ status: 'ok', app: 'FitMind', timestamp: new Date().toISOString() });
		}

		// GET /weather?city=London — proxies OpenWeather so the API key stays server-side
		if (url.pathname === '/weather' && method === 'GET') {
			const city = url.searchParams.get('city')?.trim();
			if (!city) return Response.json({ error: 'city is required' }, { status: 400 });
			const owRes = await fetch(
				`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${env.OPENWEATHER_API_KEY}&units=metric`,
			);
			if (!owRes.ok) return Response.json({ error: 'City not found' }, { status: 404 });
			const data = await owRes.json();
			return Response.json(data, {
				headers: { 'Cache-Control': 'public, max-age=600' }, // cache 10 min
			});
		}

		// GET /users?email=... or GET /users?name=... — recover profile
		if (url.pathname === '/users' && method === 'GET') {
			const email = url.searchParams.get('email')?.trim();
			const name  = url.searchParams.get('name')?.trim();
			if (!email && !name) return Response.json({ error: 'email or name is required' }, { status: 400 });
			let user = null;
			if (email) user = await getUserByEmail(env.fitness_coach_db, email);
			if (!user && name) {
				user = await env.fitness_coach_db
					.prepare(`SELECT * FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1`)
					.bind(name).first<any>();
			}
			if (!user) return Response.json({ error: 'user not found' }, { status: 404 });
			const session = await createSession(env.fitness_coach_db, user.id);
			return Response.json({ user, session });
		}

		// POST /users
		if (url.pathname === '/users' && method === 'POST') {
			let body: any;
			try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
			if (!body.name) return Response.json({ error: 'name is required' }, { status: 400 });
			const existing = body.email ? await getUserByEmail(env.fitness_coach_db, body.email) : null;
			if (existing) return Response.json({ error: 'email already exists' }, { status: 409 });
			const user = await createUser(env.fitness_coach_db, body);
			return Response.json({ user }, { status: 201 });
		}

		// GET /users/:id
		if (url.pathname.startsWith('/users/') && method === 'GET' && !url.pathname.includes('/sessions')) {
			const id = url.pathname.split('/')[2];
			const user = await getUserById(env.fitness_coach_db, id);
			if (!user) return Response.json({ error: 'user not found' }, { status: 404 });
			return Response.json({ user });
		}

		// POST /sessions
		if (url.pathname === '/sessions' && method === 'POST') {
			let body: any;
			try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
			if (!body.user_id) return Response.json({ error: 'user_id is required' }, { status: 400 });
			const user = await getUserById(env.fitness_coach_db, body.user_id);
			if (!user) return Response.json({ error: 'user not found' }, { status: 404 });
			const session = await createSession(env.fitness_coach_db, body.user_id);
			return Response.json({ session, user }, { status: 201 });
		}

		// GET /users/:id/sessions
		if (url.pathname.match(/^\/users\/[^/]+\/sessions$/) && method === 'GET') {
			const userId = url.pathname.split('/')[2];
			const sessions = await getUserSessions(env.fitness_coach_db, userId);
			return Response.json({ sessions });
		}

		// Guard all /admin/* routes with a bearer token
		if (url.pathname.startsWith('/admin/')) {
			const token = request.headers.get('Authorization')?.replace('Bearer ', '').trim();
			if (!token || token !== env.ADMIN_SECRET)
				return Response.json({ error: 'Unauthorized' }, { status: 401 });
		}

		// POST /admin/seed
		if (url.pathname === '/admin/seed' && method === 'POST') {
			const docs = [
				{ title: 'Progressive Overload', category: 'exercise', content: 'Progressive overload is the gradual increase of stress placed on the body during training. To build muscle and strength, you must consistently challenge your muscles beyond what they are used to. Increase weight, reps, sets, or decrease rest time over time. Beginners should aim to add 2.5-5kg to compound lifts every 1-2 weeks.' },
				{ title: 'Beginner 3-Day Workout Plan', category: 'exercise', content: 'A beginner 3-day full-body workout: Day 1 - Squat 3x8, Push-up 3x10, Dumbbell Row 3x10. Day 3 - Deadlift 3x6, Overhead Press 3x8, Lat Pulldown 3x10. Day 5 - Squat 3x8, Bench Press 3x8, Barbell Row 3x8. Rest 60-90 seconds between sets. Focus on form over weight.' },
				{ title: 'Protein Intake for Muscle Building', category: 'nutrition', content: 'Protein is essential for muscle repair and growth. Aim for 1.6-2.2g of protein per kg of bodyweight per day for muscle building. Good sources: chicken breast (31g/100g), eggs (6g each), Greek yogurt (10g/100g), tuna (30g/100g), whey protein (25g/scoop). Spread intake across 3-5 meals for optimal muscle protein synthesis.' },
				{ title: 'Caloric Deficit for Weight Loss', category: 'nutrition', content: 'To lose weight, consume fewer calories than you burn. A deficit of 300-500 calories per day leads to 0.3-0.5kg of fat loss per week. Avoid deficits larger than 700 calories as they cause muscle loss. Never go below 1200 calories for women or 1500 for men.' },
				{ title: 'TDEE and Calorie Calculation', category: 'nutrition', content: 'Total Daily Energy Expenditure (TDEE) = BMR x Activity Multiplier. Multipliers: Sedentary=1.2, Light=1.375, Moderate=1.55, Very active=1.725. For weight loss subtract 400 from TDEE. For muscle gain add 200-300.' },
				{ title: 'Sleep and Recovery', category: 'recovery', content: 'Sleep is when muscles grow. Aim for 7-9 hours per night. Poor sleep increases cortisol, reduces testosterone, and increases injury risk. Consistency matters more than duration.' },
				{ title: 'HIIT vs Steady-State Cardio', category: 'exercise', content: 'HIIT burns more calories in less time and creates afterburn lasting up to 24 hours. Example: 30 seconds sprint, 90 seconds walk, repeat 8 times. Steady-state cardio (30-60 min comfortable pace) is better for beginners. Combine both for best fat loss results.' },
				{ title: 'Compound vs Isolation Exercises', category: 'exercise', content: 'Compound exercises: Squat, Deadlift, Bench Press, Overhead Press, Pull-up. These should form 80% of your program. Isolation exercises (curls, lateral raises) target specific muscles and are added after compounds. Beginners should focus almost entirely on compound movements.' },
				{ title: 'Hydration for Performance', category: 'recovery', content: 'Drink 35-45ml per kg of bodyweight daily. For a 75kg person this is 2.6-3.4 litres. Add 500ml for every 30 minutes of exercise. Even 2% dehydration significantly reduces strength and endurance.' },
				{ title: 'BMI Limitations', category: 'safety', content: 'BMI does not distinguish muscle from fat. A muscular athlete may be classified as overweight. Better measures: body fat percentage (healthy: 10-20% men, 18-28% women) and waist circumference (below 94cm men, 80cm women).' },
				{ title: 'Injury Prevention', category: 'safety', content: 'Most injuries come from too much weight too soon, skipping warm-up, and poor form. Always warm up 5-10 minutes. Learn form before adding weight. Stop immediately on sharp pain. Never train to failure on squat or deadlift alone.' },
				{ title: 'Rest Days and Overtraining', category: 'recovery', content: 'Muscles grow during rest, not training. Beginners need 48-72 hours between training the same muscle. Signs of overtraining: persistent fatigue, declining performance, poor sleep. Most beginners do best with 3-4 training days per week.' },
			];
			// Clear existing knowledge so re-seeding doesn't duplicate
			await env.fitness_coach_db.prepare(`DELETE FROM knowledge_sources`).run();
			let count = 0;
			for (const doc of docs) {
				await ingestDocument(env, doc);
				count++;
			}
			return Response.json({ message: `Seeded ${count} documents` });
		}

		// POST /admin/ingest
		if (url.pathname === '/admin/ingest' && method === 'POST') {
			const cl = parseInt(request.headers.get('content-length') || '0');
			if (cl > 512 * 1024)
				return Response.json({ error: 'Document too large (max 512 KB)' }, { status: 413 });
			let body: any;
			try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
			if (!body.title || !body.content || !body.category)
				return Response.json({ error: 'title, content and category are required' }, { status: 400 });
			const id = await ingestDocument(env, body);
			return Response.json({ id, message: 'Document ingested successfully' }, { status: 201 });
		}

		// GET /admin/reviews — list all reviews (paginated)
		if (url.pathname === '/admin/reviews' && method === 'GET') {
			const page  = parseInt(url.searchParams.get('page')  ?? '1', 10);
			const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
			const reviews = await getPendingReviews(env.fitness_coach_db, page, limit);
			return Response.json({ reviews, page, limit });
		}

		// POST /admin/reviews/:id — approve or reject
		if (url.pathname.match(/^\/admin\/reviews\/[^/]+$/) && method === 'POST') {
			const id = url.pathname.split('/')[3];
			let body: any;
			try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
			if (!['approved', 'rejected', 'modified'].includes(body.status))
				return Response.json({ error: 'status must be approved, rejected, or modified' }, { status: 400 });
			await updateReview(env.fitness_coach_db, id, {
				status: body.status,
				reviewer_note: body.reviewer_note,
				modified_output: body.modified_output,
			});
			return Response.json({ success: true });
		}

		// Route all /agents/* requests to the Agents SDK (WebSocket upgrade — skip security headers)
		const agentResponse = await routeAgentRequest(request, env);
		if (agentResponse) return agentResponse;

		return Response.json({ error: 'not found' }, { status: 404 });
}

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		const res = await handleRequest(request, env);
		// WebSocket upgrade (101) responses must not be reconstructed
		if (res.status === 101) return res;
		return withSecurityHeaders(res);
	},
} satisfies ExportedHandler<Env>;

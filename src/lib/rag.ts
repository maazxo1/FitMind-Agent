import { randomUUID } from 'crypto';

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const TOP_K = 3;

export async function ingestDocument(
	env: Env,
	doc: { title: string; content: string; category: string; source_url?: string }
): Promise<string> {
	const id = randomUUID();

	// Generate embedding from the document content
	const embeddingRes = await env.AI.run(EMBEDDING_MODEL, { text: doc.content }) as any;
	const embedding: number[] | undefined = embeddingRes?.data?.[0];
	if (!Array.isArray(embedding) || embedding.length === 0)
		throw new Error('Embedding model returned an empty result — check AI binding quota');

	// Store vector in Vectorize with metadata
	await env.VECTORIZE.upsert([{
		id,
		values: embedding,
		metadata: { title: doc.title, category: doc.category },
	}]);

	// Store full text in D1
	await env.fitness_coach_db.prepare(
		`INSERT INTO knowledge_sources (id, title, content, category, source_url) VALUES (?, ?, ?, ?, ?)`
	).bind(id, doc.title, doc.content, doc.category, doc.source_url ?? null).run();

	return id;
}

export async function retrieveContext(env: Env, query: string): Promise<string> {
	try {
		// Embed the user's query
		const embeddingRes = await env.AI.run(EMBEDDING_MODEL, { text: query }) as any;
		const queryVector: number[] = embeddingRes.data[0];

		// Find top-K most similar vectors
		const matches = await env.VECTORIZE.query(queryVector, {
			topK: TOP_K,
			returnMetadata: 'all',
		});

		if (!matches.matches || matches.matches.length === 0) return '';

		// Fetch full content from D1 for matching IDs
		const ids = matches.matches.map(m => m.id);
		if (ids.length === 0) return '';
		const placeholders = ids.map(() => '?').join(', ');
		const rows = await env.fitness_coach_db.prepare(
			`SELECT title, content FROM knowledge_sources WHERE id IN (${placeholders})`
		).bind(...ids).all<{ title: string; content: string }>();

		// Format as context block for the LLM prompt
		return rows.results
			.map(r => `### ${r.title}\n${r.content}`)
			.join('\n\n');
	} catch {
		return '';
	}
}

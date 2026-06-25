export interface Message {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

export interface LLMResponse {
	text: string;
	tokens_used: number;
}

export async function callLLM(
	env: Env,
	messages: Message[],
	systemPrompt?: string
): Promise<LLMResponse> {
	// Build the contents array for Gemini format
	const contents = messages
		.filter(m => m.role !== 'system')
		.map(m => ({
			role: m.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: m.content }],
		}));

	const body: any = { contents };

	if (systemPrompt) {
		body.system_instruction = { parts: [{ text: systemPrompt }] };
	}

	// Route through Cloudflare AI Gateway
	const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_NAME}/google-ai-studio/v1beta/models/gemini-2.5-flash:generateContent`;

	const start = Date.now();
	const res = await fetch(gatewayUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-goog-api-key': env.GEMINI_API_KEY,
		},
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`LLM ${res.status}: ${errText}`);
	}

	const data: any = await res.json();
	const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
	const tokens_used =
		(data?.usageMetadata?.promptTokenCount ?? 0) +
		(data?.usageMetadata?.candidatesTokenCount ?? 0);

	console.log(`LLM call: ${tokens_used} tokens, ${Date.now() - start}ms`);

	return { text, tokens_used };
}

declare interface Env {
	GEMINI_API_KEY: string;
	OPENWEATHER_API_KEY: string;
	RAPIDAPI_KEY: string;
	CF_ACCOUNT_ID: string;
	AI_GATEWAY_NAME: string;
	ADMIN_SECRET: string;
	fitness_coach_db: D1Database;
	VECTORIZE: VectorizeIndex;
	AI: Ai;
	FitnessCoachAgent: DurableObjectNamespace<import('../agents/FitnessCoachAgent').FitnessCoachAgent>;
	WorkoutPlannerAgent: DurableObjectNamespace<import('../agents/WorkoutPlannerAgent').WorkoutPlannerAgent>;
	ASSETS: Fetcher;
}

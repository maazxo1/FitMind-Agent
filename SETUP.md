# FitMind — Complete Setup Guide

This guide takes you from a fresh clone to a fully working local dev environment and a live production deployment on Cloudflare. Follow every step in order.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone & Install Dependencies](#2-clone--install-dependencies)
3. [Get Your API Keys](#3-get-your-api-keys)
4. [Create Cloudflare Resources](#4-create-cloudflare-resources)
5. [Update wrangler.jsonc](#5-update-wranglerjsonc)
6. [Configure Local Secrets](#6-configure-local-secrets)
7. [Run Locally](#7-run-locally)
8. [Seed the Knowledge Base](#8-seed-the-knowledge-base)
9. [Deploy to Production](#9-deploy-to-production)
10. [Push Production Secrets](#10-push-production-secrets)
11. [Verify the Deployment](#11-verify-the-deployment)
12. [Optional: Cloudflare AI Gateway](#12-optional-cloudflare-ai-gateway)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Prerequisites

Make sure these are installed before you start.

| Tool | Version | Install |
|---|---|---|
| **Node.js** | 18 or higher | [nodejs.org](https://nodejs.org) |
| **npm** | comes with Node | — |
| **Wrangler CLI** | latest | `npm install -g wrangler` |
| **Git** | any | [git-scm.com](https://git-scm.com) |

You also need:

- A **Cloudflare account** — free tier is enough to get started. Sign up at [cloudflare.com](https://cloudflare.com)
- A **Google AI Studio account** — free API key at [aistudio.google.com](https://aistudio.google.com)

Once Wrangler is installed, log in to your Cloudflare account:

```bash
wrangler login
```

A browser window will open. Authorise Wrangler. You can confirm it worked with:

```bash
wrangler whoami
```

---

## 2. Clone & Install Dependencies

```bash
git clone https://github.com/your-username/fitness-coach.git
cd fitness-coach
```

Install backend dependencies:

```bash
npm install
```

Install frontend dependencies:

```bash
cd client
npm install
cd ..
```

---

## 3. Get Your API Keys

You need at least the **Gemini key** to run the app. The others unlock specific features.

### Gemini API Key (Required)

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Click **Get API Key** → **Create API key**
3. Copy the key — you'll use it as `GEMINI_API_KEY`

> The free tier includes generous Gemini 2.5 Flash quota. If you hit rate limits frequently, the app automatically falls back to Cloudflare Workers AI (Llama 3.3 70B) at no extra cost.

### OpenWeather API Key (Recommended)

Used by the workout planner to check conditions for outdoor training.

1. Sign up at [openweathermap.org](https://openweathermap.org/api)
2. Go to **API keys** → copy the default key
3. This will be `OPENWEATHER_API_KEY`

Without this key the weather tool returns an error gracefully — everything else still works.

### RapidAPI / ExerciseDB Key (Recommended)

Used by the workout planner to search real exercises by body part.

1. Sign up at [rapidapi.com](https://rapidapi.com)
2. Search for **ExerciseDB** and subscribe (free tier available)
3. Copy the `X-RapidAPI-Key` from the API's endpoint page
4. This will be `RAPIDAPI_KEY`

Without this key the exercise search tool returns an error gracefully — the AI will still write a plan from its own knowledge.

### Admin Secret (Required)

This is a password you invent yourself. It protects the `/admin` panel and the knowledge base seeding endpoint. Use any strong string:

```bash
# Example — generate a random one:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save the value as `ADMIN_SECRET`.

---

## 4. Create Cloudflare Resources

These commands create the cloud resources the Worker depends on. Run them once. They're linked to your Cloudflare account.

### 4a. Create the D1 Database

```bash
wrangler d1 create fitness-coach-db
```

Wrangler will print output like:

```
✅ Successfully created DB 'fitness-coach-db'

[[d1_databases]]
binding = "fitness_coach_db"
database_name = "fitness-coach-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   ← copy this
```

**Copy the `database_id`** — you need it in the next step.

### 4b. Apply Database Migrations

```bash
wrangler d1 migrations apply fitness-coach-db
```

This creates all tables and indexes:
- `users` — user profiles
- `sessions` — chat sessions
- `conversations` — full message history
- `human_reviews` — Human-in-the-Loop flagged responses
- `knowledge_sources` — RAG document store
- `agent_activity_logs` — observability

Confirm with `y` when prompted.

### 4c. Create the Vectorize Index

Used for Retrieval-Augmented Generation (RAG) — the AI searches this when answering questions.

```bash
wrangler vectorize create fitness-knowledge --dimensions=768 --metric=cosine
```

> ⚠️ The `--dimensions=768` must match the embedding model (`@cf/baai/bge-base-en-v1.5`). Do not change this value.

---

## 5. Update wrangler.jsonc

Open `wrangler.jsonc` and replace the `database_id` placeholder with the ID you copied in step 4a:

```jsonc
"d1_databases": [
  {
    "binding": "fitness_coach_db",
    "database_name": "fitness-coach-db",
    "database_id": "PASTE-YOUR-DATABASE-ID-HERE"   // ← replace this
  }
]
```

Save the file. This is the only line you need to change in `wrangler.jsonc`.

> The Durable Objects (`FitnessCoachAgent`, `WorkoutPlannerAgent`) and Workers AI binding are already declared in `wrangler.jsonc` — no extra setup needed.

---

## 6. Configure Local Secrets

Copy the example file:

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and fill in your values:

```ini
# Required
GEMINI_API_KEY=your_gemini_api_key_here
ADMIN_SECRET=your_strong_secret_here

# Recommended
OPENWEATHER_API_KEY=your_openweather_key_here
RAPIDAPI_KEY=your_rapidapi_key_here

# Optional — Cloudflare AI Gateway (see section 12)
CF_ACCOUNT_ID=
AI_GATEWAY_NAME=
```

> `.dev.vars` is gitignored. It never gets committed. It is only used by `wrangler dev` for local development.

---

## 7. Run Locally

You need **two terminals** running at the same time.

**Terminal 1 — Worker (backend + WebSocket server)**

```bash
npm run dev
```

This starts Wrangler's local dev server on `http://localhost:8787`. It handles:
- The REST API
- WebSocket connections to the Durable Object agents
- Workers AI (via remote binding — requires internet)

**Terminal 2 — React Frontend (with hot reload)**

```bash
npm run dev:client
```

This starts the Vite dev server on `http://localhost:5173` with instant hot module replacement.

**Open the app:** `http://localhost:5173`

> In development the frontend proxies WebSocket connections to `localhost:8787` automatically. You do not need to change any URLs.

---

## 8. Seed the Knowledge Base

The RAG knowledge base starts empty. Seed it with built-in fitness content so the AI can ground its answers in curated knowledge.

With the Worker running locally (`npm run dev` in Terminal 1):

```bash
curl -X POST http://localhost:8787/admin/seed \
  -H "Authorization: Bearer your_admin_secret_here"
```

You should get:

```json
{ "message": "Knowledge base seeded successfully" }
```

This embeds fitness documents into Vectorize and stores them in D1. You only need to do this once per environment (local and production are separate).

To add your own custom fitness documents:

```bash
curl -X POST http://localhost:8787/admin/ingest \
  -H "Authorization: Bearer your_admin_secret_here" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Custom Guide",
    "content": "...",
    "category": "nutrition"
  }'
```

---

## 9. Deploy to Production

This single command builds the React frontend and deploys everything to Cloudflare:

```bash
npm run deploy
```

What it does internally:
1. `cd client && npm run build` — compiles React/Vite into `public/`
2. `wrangler deploy` — uploads the Worker, Durable Objects, and compiled frontend assets

After a successful deploy, Wrangler prints your Worker URL:

```
✅ Deployed fitness-coach to https://fitness-coach.your-subdomain.workers.dev
```

---

## 10. Push Production Secrets

Secrets in `.dev.vars` are **local only**. For production, push each one with Wrangler:

```bash
wrangler secret put GEMINI_API_KEY
# paste your key when prompted

wrangler secret put ADMIN_SECRET
# paste your admin secret

wrangler secret put OPENWEATHER_API_KEY
# paste your key

wrangler secret put RAPIDAPI_KEY
# paste your key
```

If you're using the AI Gateway (optional):

```bash
wrangler secret put CF_ACCOUNT_ID
wrangler secret put AI_GATEWAY_NAME
```

> You can also set secrets through the Cloudflare Dashboard under **Workers & Pages → fitness-coach → Settings → Variables & Secrets**.

After pushing secrets, **seed the production knowledge base**:

```bash
curl -X POST https://fitness-coach.your-subdomain.workers.dev/admin/seed \
  -H "Authorization: Bearer your_admin_secret_here"
```

---

## 11. Verify the Deployment

Run through these checks after deploying:

```bash
# Health check
curl https://fitness-coach.your-subdomain.workers.dev/health
# Expected: { "status": "ok" }
```

1. Open the app URL in a browser
2. Complete onboarding (enter your name, age, weight, height, goal)
3. Send a fitness question — response should start streaming within 1–2 seconds
4. Ask for a workout plan — should stream word-by-word
5. Open the sidebar → **Coach Memory** — notes should appear after a few messages
6. Open `/admin` → enter your `ADMIN_SECRET` → check the Human Reviews panel loads

---

## 12. Optional: Cloudflare AI Gateway

The AI Gateway adds observability, request logging, cost tracking, and rate limiting for all Gemini API calls. Recommended for production.

**Set it up:**

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **AI** → **AI Gateway**
2. Click **Create Gateway** — give it any name (e.g. `fitmind-gateway`)
3. Note your **Account ID** (top-right of the dashboard or in the URL)
4. Note your **Gateway Name** (what you just entered)

**Add to `.dev.vars`** for local use:

```ini
CF_ACCOUNT_ID=your_account_id
AI_GATEWAY_NAME=fitmind-gateway
```

**Add to production secrets:**

```bash
wrangler secret put CF_ACCOUNT_ID
wrangler secret put AI_GATEWAY_NAME
```

When these two variables are set, all Gemini requests route through:
```
https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/google-ai-studio/...
```

You can then see every request, response, latency, and cost in the AI Gateway dashboard.

---

## 13. Troubleshooting

### "Error: No such binding 'AI'" or "AI is not defined"

The Workers AI binding requires a Cloudflare account. It cannot run fully offline. Make sure:
- You're logged in: `wrangler whoami`
- The `ai` binding is in `wrangler.jsonc` with `"remote": true`

### "database_id is invalid" or D1 errors

You forgot to update `wrangler.jsonc` with your own `database_id`. Repeat step 5.

### WebSocket never connects (spinning "Connecting...")

- Make sure `npm run dev` (Terminal 1) is running
- Check the browser console for WebSocket errors
- The WS URL in dev is `ws://localhost:8787/agents/fitness-coach-agent/{userId}` — confirm the Worker is on port 8787

### Responses appear all at once instead of streaming

This was a known bug — ensure you're on the latest version of the code. The fix disables Gemini 2.5 Flash thinking mode (`thinkingBudget: 0`) and filters `thought` parts from the SSE stream.

### "The AI is under high demand" error shown in chat

This was a known bug — ensure you're on the latest version. The fix makes the app silently fall back to Workers AI (Llama 3.3 70B) on both 429 and 500/503 Gemini errors.

### "Embedding model returned an empty result" during seed

The Workers AI embedding model requires an internet connection from `wrangler dev`. Confirm you're online and the `AI` binding has `"remote": true` in `wrangler.jsonc`.

### Admin panel shows "Unauthorized"

The `Authorization: Bearer` header must exactly match your `ADMIN_SECRET`. In the browser Admin panel, enter the secret in the password prompt (stored in sessionStorage with a 2-hour TTL).

### Vectorize returns no results after seeding

Wait 15–30 seconds after seeding — Vectorize index writes are eventually consistent. Then try sending a fitness question again.

### "wrangler: command not found"

Install it globally: `npm install -g wrangler`, then restart your terminal.

---

## Quick Reference

```bash
# Local development
npm run dev              # start Worker on :8787
npm run dev:client       # start React on :5173

# Build frontend only
npm run build:client

# Deploy everything
npm run deploy

# Apply DB migrations
wrangler d1 migrations apply fitness-coach-db

# Push a secret
wrangler secret put SECRET_NAME

# List secrets
wrangler secret list

# View live logs from production
wrangler tail

# Generate TypeScript types from bindings
npm run cf-typegen
```

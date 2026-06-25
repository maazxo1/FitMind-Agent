<div align="center">

# FitMind — AI Fitness Coach

**A production-grade, multi-agent AI fitness coach built entirely on Cloudflare's edge platform.**

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Gemini 2.5 Flash](https://img.shields.io/badge/Google-Gemini%202.5%20Flash-4285F4?style=flat&logo=google&logoColor=white)](https://ai.google.dev)
[![Workers AI](https://img.shields.io/badge/Cloudflare-Workers%20AI-F38020?style=flat&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers-ai/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat&logo=vite&logoColor=white)](https://vitejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat)](LICENSE)

[![Setup Guide](https://img.shields.io/badge/docs-Setup%20Guide-0ea5e9?style=flat&logo=read-the-docs&logoColor=white)](SETUP.md)

---

*Real-time streaming responses · Persistent memory · Fallback AI · RAG knowledge base · Human-in-the-loop safety*

</div>

---

## What It Does

FitMind is a personal AI fitness coach that:

- → **Streams responses token-by-token** via WebSocket for an instant, fluid chat experience
- → **Remembers you** across every session — injuries, preferences, progress, goals
- → **Plans workouts** by delegating to a specialist Workout Planner agent that searches real exercise databases
- → **Calculates nutrition** — calories, macros, and protein targets via built-in tools
- → **Checks live weather** for outdoor training recommendations
- → **Never goes down** — falls back to a second AI (Meta Llama 3.3 70B via Workers AI) if Gemini is unavailable
- → **Grounds answers in a knowledge base** using Retrieval-Augmented Generation (Vectorize)
- → **Flags unsafe plans** for human trainer review (Human-in-the-Loop)
- → **Runs at the edge** — globally distributed with zero cold-start latency

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser Client                          │
│              React 19 + Vite  ·  WebSocket  ·  SSE             │
└──────────────────────────┬──────────────────────────────────────┘
                           │  wss://
┌──────────────────────────▼──────────────────────────────────────┐
│                    Cloudflare Worker                            │
│          REST API  ·  Static Assets  ·  WS Upgrade             │
│                    (src/index.ts)                               │
└──────┬───────────────────┬───────────────────────┬─────────────┘
       │                   │                       │
┌──────▼──────┐  ┌─────────▼──────────┐  ┌────────▼──────────────┐
│  D1 (SQLite)│  │ FitnessCoachAgent  │  │  Cloudflare Vectorize │
│             │  │  Durable Object    │  │  (RAG Knowledge Base) │
│  · users    │  │                    │  └───────────────────────┘
│  · sessions │  │  · Streaming chat  │
│  · messages │  │  · Long-term mem   │
│  · reviews  │  │  · Tool execution  │
│  · RAG docs │  └────────┬───────────┘
└─────────────┘           │
                    ┌─────┴──────────────────────────────┐
                    │                                    │
          ┌─────────▼──────────┐             ┌──────────▼──────────┐
          │  Gemini 2.5 Flash  │             │  WorkoutPlannerAgent │
          │  (via AI Gateway)  │             │   Durable Object     │
          │                    │             │                      │
          │  · SSE streaming   │             │  · Gemini (non-str.) │
          │  · Function calls  │             │  · Exercise DB API   │
          │  · Thinking off    │             │  · OpenWeather API   │
          └─────────┬──────────┘             └──────────┬──────────┘
                    │ fallback (429/5xx)                 │ fallback (429)
          ┌─────────▼──────────┐                        │
          │  Workers AI        │◄───────────────────────┘
          │  Llama 3.3 70B FP8 │
          └────────────────────┘
```

### Two-Agent System

| Agent | Type | Role |
|---|---|---|
| **FitnessCoachAgent** | Durable Object | Primary conversational agent. Manages WebSocket connections, streams Gemini responses, runs tools, maintains per-user memory |
| **WorkoutPlannerAgent** | Durable Object | Specialist sub-agent invoked only for workout plan generation. Calls exercise databases and weather APIs, returns structured markdown |

---

## Tech Stack

### Backend — Cloudflare Workers Platform

| Technology | Purpose |
|---|---|
| <img src="https://cdn.simpleicons.org/cloudflare/F38020" width="14" height="14"> **Cloudflare Workers** | Serverless edge runtime — globally distributed, zero cold starts |
| <img src="https://cdn.simpleicons.org/cloudflare/F38020" width="14" height="14"> **Durable Objects** | Stateful agents with hibernatable WebSocket support and built-in SQLite |
| <img src="https://cdn.simpleicons.org/cloudflare/F38020" width="14" height="14"> **D1 (SQLite)** | Persistent storage — users, sessions, conversation history, HITL reviews |
| <img src="https://cdn.simpleicons.org/cloudflare/F38020" width="14" height="14"> **Vectorize** | Vector database for RAG — stores fitness knowledge embeddings |
| <img src="https://cdn.simpleicons.org/cloudflare/F38020" width="14" height="14"> **Workers AI** | Fallback inference (Meta Llama 3.3 70B FP8) + text embedding model |
| <img src="https://cdn.simpleicons.org/cloudflare/F38020" width="14" height="14"> **AI Gateway** | Observability, logging, and request routing for all Gemini API calls |
| <img src="https://cdn.simpleicons.org/cloudflare/F38020" width="14" height="14"> **Agents SDK** | `agents` package — agent routing, WebSocket lifecycle, state management |

### AI / LLM

| Model | Role |
|---|---|
| <img src="https://cdn.simpleicons.org/google/4285F4" width="14" height="14"> **Gemini 2.5 Flash** | Primary LLM — streaming chat, function calling, workout planning |
| <img src="https://cdn.simpleicons.org/meta/0467DF" width="14" height="14"> **Meta Llama 3.3 70B FP8** | Fallback LLM via Workers AI when Gemini is rate-limited or unavailable |
| <img src="https://cdn.simpleicons.org/cloudflare/F38020" width="14" height="14"> **BGE Base EN v1.5** | Converts fitness documents into vectors for semantic search (RAG) |

### Frontend

| Technology | Purpose |
|---|---|
| <img src="https://cdn.simpleicons.org/react/61DAFB" width="14" height="14"> **React 19** | UI framework |
| <img src="https://cdn.simpleicons.org/vite/646CFF" width="14" height="14"> **Vite 8** | Build tool — output bundled directly into `public/` for the Worker to serve |
| <img src="https://cdn.simpleicons.org/react/61DAFB" width="14" height="14"> **React Router v7** | Client-side routing (Onboarding → Chat → Admin) |
| <img src="https://cdn.simpleicons.org/typescript/3178C6" width="14" height="14"> **TypeScript** | End-to-end type safety across Worker and React client |
| <img src="https://cdn.simpleicons.org/react/61DAFB" width="14" height="14"> **React Markdown** | Renders streaming AI responses as formatted markdown with live cursor |

---

## Key Engineering Practices

### Resilient Streaming

- Gemini responses are consumed as SSE (`streamGenerateContent?alt=sse`) and re-emitted token-by-token over the client's WebSocket connection
- Thinking tokens (`thought: true`) are filtered before reaching the client — model reasoning never leaks into the UI
- `thinkingBudget: 0` disables Gemini 2.5 Flash's extended thinking for chat — eliminates the 5–15 s pre-streaming delay
- `TextDecoder` uses `{ stream: true }` mode to correctly handle multi-byte UTF-8 characters across chunk boundaries

### Automatic Fallback

- On any Gemini 429 / 500 / 503 response, `FitnessCoachAgent` transparently switches to Workers AI (Llama 3.3) for that request
- `WorkoutPlannerAgent` has its own independent fallback to Workers AI on 429
- Fallback is invisible to the user — the status indicator briefly shows "Backup AI thinking…" then streaming continues normally

### Persistent Agent Memory

- The agent proactively saves facts about the user (injuries, preferences, progress) using the `save_user_note` tool
- Memory is stored in Durable Object state and persisted to D1, surviving across deploys and DO hibernation cycles
- Up to 30 facts are retained; older facts are evicted. Users can view and delete memories from the UI

### RAG — Retrieval-Augmented Generation

- An admin endpoint seeds a Cloudflare Vectorize index with fitness documents
- On every user message, the top-K relevant chunks are retrieved by cosine similarity and injected into the system prompt
- Keeps answers grounded in curated knowledge rather than relying solely on model weights

### Human-in-the-Loop Safety

- The `flag_for_human_review` tool lets the AI escalate acute safety concerns (extreme plans, medical red flags) to a human trainer
- Flagged responses are stored in D1 and visible in the `/admin` panel
- Reviewers can approve, reject, or modify the agent's planned output before it influences future advice

### Security

- All API keys (`GEMINI_API_KEY`, `OPENWEATHER_API_KEY`, `RAPIDAPI_KEY`) are server-side secrets — never exposed to the browser
- Weather and exercise data are proxied through the Worker, preventing key leakage
- Admin panel protected by `ADMIN_SECRET` Bearer token with a sessionStorage 2-hour TTL
- Inter-agent calls authenticated with `X-Internal-Key` header
- Input validated at every WebSocket message boundary (type, length, value ranges)

### Performance

- Tool-call turns do not block streaming — text chunks from non-tool turns stream immediately
- Concurrent `setState` calls in the Durable Object are serialized through a `chatQueue` promise chain to prevent race conditions
- Conversation history is capped at 20 turns in DO state (full history in D1); DO ↔ D1 sync happens on `onStart`

---

## Project Structure

```
fitness-coach/
├── src/                           # Worker backend (TypeScript)
│   ├── index.ts                   # Main worker entry — REST API + agent routing
│   ├── agents/
│   │   ├── FitnessCoachAgent.ts   # Primary stateful chat agent (Durable Object)
│   │   └── WorkoutPlannerAgent.ts # Specialist workout sub-agent (Durable Object)
│   ├── lib/
│   │   ├── db.ts                  # D1 query helpers
│   │   ├── rag.ts                 # Vectorize embed + retrieve
│   │   └── llm.ts                 # Non-streaming Gemini helper (admin/seed routes)
│   └── types/
│       └── env.d.ts               # Cloudflare binding type declarations
│
├── client/                        # React frontend (Vite)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Onboarding.tsx     # User registration / profile recovery
│   │   │   ├── Chat.tsx           # Main streaming chat UI
│   │   │   └── Admin.tsx          # HITL trainer review panel
│   │   ├── components/
│   │   │   ├── WeatherWidget.tsx
│   │   │   └── ErrorBoundary.tsx
│   │   └── lib/
│   │       └── storage.ts         # LocalStorage helpers
│   └── index.html
│
├── migrations/                    # D1 SQL migrations (applied via wrangler)
│   ├── 0001_initial_schema.sql
│   └── 0002_add_indexes.sql
│
├── public/                        # Built frontend (generated — do not edit)
├── wrangler.jsonc                 # Cloudflare Worker configuration
├── SETUP.md                       # Full setup and deployment guide
├── .dev.vars.example              # Environment variable template
└── package.json
```

---

## Getting Started

For a full step-by-step walkthrough covering API keys, Cloudflare resource creation, local development, seeding, deployment, and troubleshooting, see the **[Setup Guide](SETUP.md)**.

### Quick start

```bash
git clone https://github.com/your-username/fitmind-ai.git
cd fitmind-ai
npm install && cd client && npm install && cd ..
cp .dev.vars.example .dev.vars   # fill in your keys
npm run dev                       # Worker on :8787
npm run dev:client                # React on :5173
```

---

## REST API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | — | Health check |
| `GET` | `/users?email=` | — | Look up user by email |
| `POST` | `/users` | — | Create new user |
| `GET` | `/users/:id` | — | Get user profile |
| `POST` | `/sessions` | — | Create session |
| `GET` | `/users/:id/sessions` | — | List sessions |
| `GET` | `/weather?city=` | — | Proxied OpenWeather data |
| `POST` | `/admin/seed` | Bearer | Seed RAG knowledge base |
| `POST` | `/admin/ingest` | Bearer | Add custom document to RAG |
| `GET` | `/admin/reviews` | Bearer | List flagged HITL reviews |
| `POST` | `/admin/reviews/:id` | Bearer | Approve / reject / modify review |
| `WS` | `/agents/fitness-coach-agent/:userId` | — | Persistent WebSocket to agent |

---

## Database Schema

| Table | Purpose |
|---|---|
| `users` | User profiles — name, age, weight, height, goal, activity level, medical notes |
| `sessions` | Tracks Durable Object sessions per user |
| `conversations` | Full message history — role, content, tool name, token count |
| `human_reviews` | HITL queue — agent output, reason, reviewer notes, status |
| `knowledge_sources` | RAG documents — title, content, category, source URL |
| `agent_activity_logs` | Observability — tool calls, latency, cost tracking |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Required | Google AI Studio key for Gemini 2.5 Flash |
| `ADMIN_SECRET` | Required | Bearer token for admin endpoints |
| `OPENWEATHER_API_KEY` | Recommended | OpenWeatherMap key (weather tool in workout planner) |
| `RAPIDAPI_KEY` | Recommended | RapidAPI key for ExerciseDB (exercise search tool) |
| `CF_ACCOUNT_ID` | Optional | Cloudflare account ID — enables AI Gateway routing |
| `AI_GATEWAY_NAME` | Optional | AI Gateway name — enables request logging and analytics |

---

## License

MIT © 2025

---

<div align="center">

Built for the **Cloudflare AI Agent Challenge** · Powered by [Cloudflare Workers](https://workers.cloudflare.com) · [Agents SDK](https://github.com/cloudflare/agents)

</div>

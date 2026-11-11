# AgentFlow AI

A production-oriented multi-agent starter built with React, TypeScript, Express, LangGraph.js, OpenAI and MongoDB.

## Architecture

- **Web:** React + Vite + TypeScript
- **API:** Express + TypeScript; owns auth boundaries, validation and SSE transport
- **Orchestration:** LangGraph.js supervisor workflow with researcher, planner, executor and reviewer specialists
- **Persistence:** MongoDB application collections plus the LangGraph MongoDB checkpointer
- **LLM:** OpenAI through `@langchain/openai`

## Prerequisites

- Node.js 20+
- npm 10+
- MongoDB 7+ or MongoDB Atlas
- OpenAI API key

## Quick start

```bash
cp .env.example .env
# Set OPENAI_API_KEY and MONGODB_URI in .env
npm install
npm run dev
```

Open http://localhost:5173. API health: http://localhost:4000/health.

## Workflow

`START -> supervisor -> researcher -> planner -> executor -> reviewer -> END`

The initial graph uses a deterministic specialist sequence for easy inspection. Follow-up increments should add conditional routing, parallel fan-out, tool permissions and human approval.

## API

`POST /api/threads/:threadId/runs` accepts `{ "message": "..." }` and streams `run.started`, `agent.update`, `run.completed` and `run.error` events over SSE. Progress events expose safe status summaries, not private chain-of-thought.

## Production hardening

- Add OIDC/JWT authentication and derive identity server-side.
- Authorize every thread against its owner before invoking or reading it.
- Add rate limits, quotas and per-user concurrency limits.
- Add tool allowlists, input schemas, timeouts, idempotency and audit logs.
- Require human approval before consequential external actions.
- Add retention policies, encryption, tracing, metrics, alerts and integration tests.
- Use managed MongoDB with backups and TLS; configure exact production CORS origins.

**Security:** This starter has no authentication and is for local development. Do not expose it publicly until the production hardening items are implemented. Never put the OpenAI key in the React app.

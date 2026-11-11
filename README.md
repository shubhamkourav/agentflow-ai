# AgentFlow AI

A multi-agent starter built with React, TypeScript, Express, LangGraph.js, OpenAI and MongoDB.

## Architecture

- **Web:** React + Vite + TypeScript
- **API:** Express + TypeScript; validates requests and streams run progress over SSE
- **Orchestration:** LangGraph.js with a conditional supervisor, parallel research and risk analysis, planning, an approval interrupt, execution and review
- **Persistence:** MongoDB application collections plus the LangGraph MongoDB checkpointer
- **LLM:** OpenAI through `@langchain/openai`

## Workflow

The supervisor classifies each request and selects the relevant path:

```text
START -> supervisor
           |-- research -> researcher -----|
           |                 riskAnalyst ---|-> planner
           |-- plan --------------------------> planner
           |-- execute -----------------------> [approval if required]
           |-- clarify -----------------------> reviewer
planner -> [approval if required] -> executor -> reviewer
reviewer -> planner (one bounded revision pass) OR END
```

Research and risk analysis run as parallel branches when the supervisor selects research. The reviewer can request one bounded revision pass. Requests that may cause external side effects pause at a LangGraph interrupt until a human approves or rejects them.

**Important:** Approval only clears the workflow gate. This starter does not yet configure external action tools, so the executor prepares deliverables and does not send messages, publish content, modify production data or perform other external side effects.

## Quick start

Prerequisites: Node.js 20+, npm 10+, MongoDB 7+ or MongoDB Atlas, and an OpenAI API key.

```bash
cp .env.example .env
# Set OPENAI_API_KEY and MONGODB_URI in .env
npm install
npm run dev
```

Open http://localhost:5173. API health: http://localhost:4000/health.

## API

- `POST /api/threads` creates a thread and returns a UUID.
- `POST /api/threads/:threadId/runs` accepts `{ "message": "..." }` and streams `run.started`, `agent.update`, `run.awaiting_approval`, `run.completed` and `run.error` events over SSE.
- `POST /api/threads/:threadId/approve` resumes a paused workflow with `{ "approved": true | false, "note": "optional" }`.

Progress events expose safe status summaries, not private chain-of-thought. A client should show an approval UI when it receives `run.awaiting_approval`, then call the approval endpoint. Persist the thread ID so a paused run can be resumed.

## Production hardening

- Add OIDC/JWT authentication and derive identity server-side.
- Authorize every thread against its owner before invoking, approving or reading it.
- Add rate limits, quotas and per-user concurrency limits.
- Connect only scoped tools with strict schemas, allowlists, timeouts, idempotency and audit logs.
- Bind approval decisions to the authenticated user, pending interrupt and exact action payload.
- Add run cancellation, retention policies, encryption, tracing, metrics, alerts and integration tests.
- Use managed MongoDB with backups and TLS; configure exact production CORS origins.

**Security:** This starter has no authentication and is for local development. Do not expose it publicly until the production hardening items are implemented. Never put the OpenAI key in the React app.

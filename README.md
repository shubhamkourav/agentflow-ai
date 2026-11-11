# AgentFlow AI

A multi-agent starter built with React, TypeScript, Express, LangGraph.js, OpenAI and MongoDB.

## Architecture

- **Web:** React + Vite + TypeScript; account sign-in and private conversation history
- **API:** Express + TypeScript; JWT authentication, request validation, rate limiting and SSE progress
- **Orchestration:** LangGraph.js with conditional routing, parallel research/risk analysis, planning, human approval, execution and review
- **Persistence:** MongoDB users, conversations, approvals and audit events, plus the LangGraph checkpointer
- **LLM:** OpenAI through `@langchain/openai`

## Workflow

The supervisor routes requests to the relevant specialists. Research and risk analysis can run in parallel and converge on planning. A reviewer can request one bounded revision pass. Consequential requests pause at a LangGraph interrupt.

## Security features

- Registration and login with bcrypt password hashing (12 salt rounds).
- Signed JWT access tokens; the API derives the user identity from a verified token.
- Authentication is required for conversation and approval endpoints.
- Every conversation read, run and approval checks the authenticated owner.
- Authentication and general API rate limits.
- Unique user email index and indexes for private conversation queries.
- Approval decisions are one-time, owner-scoped and bound to a SHA-256 digest of the exact pending interrupt payload.
- Audit events record conversation creation, run start/completion/failure and approval lifecycle events.

## Quick start

Prerequisites: Node.js 20+, npm 10+, MongoDB 7+ or MongoDB Atlas, and an OpenAI API key.

```bash
cp .env.example .env
# Set OPENAI_API_KEY, MONGODB_URI and a random JWT_SECRET (32+ characters)
npm install
npm run dev
```

Open http://localhost:5173. API health: http://localhost:4000/health.

## API

### Authentication

- `POST /api/auth/register` — `{ "name": "...", "email": "...", "password": "at least 12 chars" }`
- `POST /api/auth/login` — `{ "email": "...", "password": "..." }`
- `GET /api/auth/me` — returns the authenticated user.

Register/login return an access token. Send it as `Authorization: Bearer <token>` on all conversation routes.

### Conversations

- `POST /api/threads` creates a private conversation for the authenticated user.
- `GET /api/threads` lists only that user's conversations.
- `GET /api/threads/:threadId` reads only a conversation owned by the caller.
- `POST /api/threads/:threadId/runs` accepts `{ "message": "..." }` and streams progress over SSE.
- `POST /api/threads/:threadId/approve` resumes a pending workflow with `{ "approved": true | false, "note": "optional" }`.

The approval endpoint verifies conversation ownership, checks that the stored pending approval still matches the exact LangGraph interrupt payload, and atomically consumes the pending decision before resuming the workflow.

## Audit data

The `audit_events` MongoDB collection stores owner-scoped security and workflow events. The `approval_requests` collection stores the digest and lifecycle of pending approvals. These collections are internal server data and are not exposed through public API endpoints.

## Production hardening still required

- Use HTTPS and a secure secrets manager; rotate JWT signing keys and add refresh-token/session revocation.
- Consider HttpOnly secure cookies and CSRF protection if switching away from bearer-token storage.
- Add account verification, password reset, lockout policy and abuse monitoring.
- Add explicit authorization tests and integration tests for cross-user access and approval replay.
- Configure trusted proxy settings correctly before relying on IP-based rate limits.
- Add retention policies, audit export, backups, encryption at rest and operational monitoring.
- Implement only narrowly scoped external tools with strict schemas, idempotency keys, timeouts and per-action authorization.

**Important:** The executor currently prepares deliverables only. No external action tools are connected, so approving a workflow does not send messages, publish content, modify production data or spend money. The app is still a development starter and must receive a security review before public deployment. Never put the OpenAI or JWT secret in the React app.

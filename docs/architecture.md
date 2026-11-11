# Architecture notes

## Trust boundaries

Browser -> Express API -> LangGraph -> model/tools.

- The browser never receives model credentials.
- Express validates input and owns identity/authorization.
- Graph state is partitioned by server-authorized thread IDs.
- Tool implementations must validate arguments and enforce per-user permissions.
- Approval is a workflow gate, not proof that a user is authorized; the API must authenticate and authorize the approver.

## Agent responsibilities

- Supervisor: classifies the request, creates a task brief and chooses the workflow route.
- Researcher: gathers evidence (connect a search tool before claiming live research).
- Risk analyst: independently identifies security, privacy, reliability and operational risks.
- Planner: creates ordered steps, dependencies and acceptance criteria.
- Approval gate: pauses with a LangGraph interrupt for requests flagged as consequential.
- Executor: creates a deliverable; external side effects are not configured in this starter.
- Reviewer: checks consistency and can request one bounded revision pass.

## Routing and parallelism

The supervisor uses conditional edges. Research and risk analysis are parallel branches when research is selected; both converge on planning. Plan-only and execute-only requests skip unnecessary specialist stages. The reviewer may return the workflow to planning once, preventing unbounded review loops.

## Human approval and resume

The approval node calls LangGraph `interrupt()`. The API reports `run.awaiting_approval` over SSE. A client submits a decision to `POST /api/threads/:threadId/approve`; the server resumes the checkpointed graph with `Command({ resume })`.

Before production, bind each pending approval to an authenticated principal, exact action payload, expiration and one-time decision. Do not rely on a client-supplied thread ID as authorization.

## Persistence

Use a MongoDB checkpointer for graph thread state. Store product-level entities separately:
`users`, `conversations`, `messages`, `agent_runs`, `audit_events`.
Do not assume checkpoint documents are a substitute for an application conversation model.

## Next increments

1. Add authentication and per-thread ownership enforcement.
2. Add scoped search and internal knowledge retrieval tools.
3. Add tool execution with per-action schemas, audit logs and approval payload binding.
4. Add run cancellation, resumability and per-user concurrency.
5. Add LangSmith observability, metrics and integration tests.


## Identity, ownership and audit

Registration stores a bcrypt password hash, never the plaintext password. Login returns a short-lived signed JWT. The API validates the token signature, issuer, audience and expiry; user identity is never accepted from request bodies.

Conversation records contain an owner ID. Every thread read, run and approval performs an owner-scoped lookup before accessing LangGraph state. A UUID is an identifier, not an authorization secret.

Audit events are written to `audit_events`. Pending approval metadata is stored in `approval_requests`; the approval decision is bound to the authenticated owner, thread ID and SHA-256 digest of the current interrupt payload. The pending record is atomically transitioned so a second decision cannot replay it.

## Remaining production controls

JWT revocation/refresh, email verification, password reset, account lockout, robust proxy-aware rate limiting, encryption/retention policy, external tool adapters and security integration tests remain future work. The current executor does not invoke external systems.

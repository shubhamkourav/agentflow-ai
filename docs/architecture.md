# Architecture notes

## Trust boundaries

Browser -> Express API -> LangGraph -> model/tools.

- The browser never receives model credentials.
- Express validates input and owns identity/authorization.
- Graph state is partitioned by server-authorized thread IDs.
- Tool implementations must validate arguments and enforce per-user permissions.

## Agent responsibilities

- Supervisor: creates task brief and selects/coordinates work.
- Researcher: gathers evidence (connect a search tool before claiming live research).
- Planner: produces ordered steps and acceptance criteria.
- Executor: creates a deliverable; external side effects require explicit approval.
- Reviewer: checks consistency and synthesizes the response.

## Persistence

Use a MongoDB checkpointer for graph thread state. Store product-level entities separately:
`users`, `conversations`, `messages`, `agent_runs`, `audit_events`.
Do not assume checkpoint documents are a substitute for an application conversation model.

## Next architecture increments

1. Replace fixed sequence with conditional supervisor routing.
2. Add a search tool and a scoped internal knowledge retrieval tool.
3. Add interrupt/approval before tools with external side effects.
4. Add run cancellation, resumability and per-user concurrency.
5. Add trace IDs and LangSmith observability.

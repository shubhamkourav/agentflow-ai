import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

export type AgentRoute = "research" | "plan" | "execute" | "clarify";

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
  }),
  userRequest: Annotation<string>({ reducer: (_current, update) => update, default: () => "" }),
  taskBrief: Annotation<string>({ reducer: (_current, update) => update, default: () => "" }),
  route: Annotation<AgentRoute>({ reducer: (_current, update) => update, default: () => "research" }),
  requiresApproval: Annotation<boolean>({ reducer: (_current, update) => update, default: () => false }),
  approvalStatus: Annotation<"not_required" | "pending" | "approved" | "rejected">({
    reducer: (_current, update) => update,
    default: () => "not_required"
  }),
  research: Annotation<string>({ reducer: (_current, update) => update, default: () => "" }),
  riskAssessment: Annotation<string>({ reducer: (_current, update) => update, default: () => "" }),
  plan: Annotation<string>({ reducer: (_current, update) => update, default: () => "" }),
  execution: Annotation<string>({ reducer: (_current, update) => update, default: () => "" }),
  reviewNotes: Annotation<string>({ reducer: (_current, update) => update, default: () => "" }),
  needsRevision: Annotation<boolean>({ reducer: (_current, update) => update, default: () => false }),
  reviewCount: Annotation<number>({ reducer: (_current, update) => update, default: () => 0 }),
  finalAnswer: Annotation<string>({ reducer: (_current, update) => update, default: () => "" })
});

export type AgentStateType = typeof AgentState.State;

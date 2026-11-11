import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
  }),
  userRequest: Annotation<string>({ reducer: (_current, update) => update, default: () => "" }),
  taskBrief: Annotation<string>({ reducer: (_current, update) => update, default: () => "" }),
  research: Annotation<string>({ reducer: (_current, update) => update, default: () => "" }),
  plan: Annotation<string>({ reducer: (_current, update) => update, default: () => "" }),
  execution: Annotation<string>({ reducer: (_current, update) => update, default: () => "" }),
  finalAnswer: Annotation<string>({ reducer: (_current, update) => update, default: () => "" })
});

export type AgentStateType = typeof AgentState.State;

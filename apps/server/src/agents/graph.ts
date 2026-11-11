import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { END, interrupt, START, StateGraph } from "@langchain/langgraph";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { z } from "zod";
import { env } from "../config/env.js";
import { mongoClient } from "../db/mongo.js";
import { AgentState, type AgentStateType, type AgentRoute } from "./state.js";
import { prompts } from "./prompts.js";

const model = new ChatOpenAI({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL, temperature: 0.2, timeout: 60_000, maxRetries: 2 });

async function invokeText(systemPrompt: string, state: AgentStateType) {
  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage([
      `User request:\n${state.userRequest}`,
      `\nSupervisor brief:\n${state.taskBrief || "Not available yet."}`,
      `\nResearch findings:\n${state.research || "Not available yet."}`,
      `\nRisk assessment:\n${state.riskAssessment || "Not available yet."}`,
      `\nPlan:\n${state.plan || "Not available yet."}`,
      `\nExecution notes:\n${state.execution || "Not available yet."}`,
      `\nApproval status:\n${state.approvalStatus}`,
      `\nReviewer notes:\n${state.reviewNotes || "Not available yet."}`
    ].join("\n"))
  ]);
  return typeof response.content === "string" ? response.content : JSON.stringify(response.content);
}

function parseJson<T>(raw: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return schema.parse(JSON.parse(cleaned));
  } catch {
    return fallback;
  }
}

const supervisorSchema = z.object({
  taskBrief: z.string().min(1),
  route: z.enum(["research", "plan", "execute", "clarify"]),
  requiresApproval: z.boolean()
});

const reviewSchema = z.object({
  finalAnswer: z.string().min(1),
  reviewNotes: z.string(),
  needsRevision: z.boolean()
});

const supervisor = async (state: AgentStateType) => {
  const raw = await invokeText(prompts.supervisor, state);
  const result = parseJson(raw, supervisorSchema, {
    taskBrief: "Prepare a useful response to the user's request.",
    route: "research" as AgentRoute,
    requiresApproval: false
  });
  return {
    taskBrief: result.taskBrief,
    route: result.route,
    requiresApproval: result.requiresApproval,
    approvalStatus: result.requiresApproval ? "pending" as const : "not_required" as const
  };
};

const researcher = async (state: AgentStateType) => ({ research: await invokeText(prompts.researcher, state) });
const riskAnalyst = async (state: AgentStateType) => ({ riskAssessment: await invokeText(prompts.riskAnalyst, state) });
const planner = async (state: AgentStateType) => ({ plan: await invokeText(prompts.planner, state) });
const executor = async (state: AgentStateType) => ({ execution: await invokeText(prompts.executor, state) });

const approvalGate = async (state: AgentStateType) => {
  const decision = interrupt({
    type: "human_approval_required",
    message: "The requested workflow may cause an external side effect. Approve the execution stage to continue.",
    taskBrief: state.taskBrief,
    plan: state.plan
  }) as { approved?: boolean; note?: string };
  return {
    approvalStatus: decision?.approved ? "approved" as const : "rejected" as const,
    reviewNotes: decision?.note ?? ""
  };
};

const reviewer = async (state: AgentStateType) => {
  const raw = await invokeText(prompts.reviewer, state);
  const result = parseJson(raw, reviewSchema, {
    finalAnswer: state.approvalStatus === "rejected"
      ? "Execution was not approved, so no execution was performed. I can still help prepare a safe draft or revised plan."
      : state.execution || state.plan || state.research || state.taskBrief,
    reviewNotes: "The reviewer response could not be parsed; a safe fallback was returned.",
    needsRevision: false
  });
  return {
    finalAnswer: result.finalAnswer,
    reviewNotes: result.reviewNotes,
    needsRevision: result.needsRevision,
    reviewCount: state.reviewCount + 1,
    messages: [new AIMessage(result.finalAnswer)]
  };
};

function afterSupervisor(state: AgentStateType): string[] {
  if (state.route === "research") return ["researcher", "riskAnalyst"];
  if (state.route === "plan") return ["planner"];
  if (state.route === "execute") return [state.requiresApproval ? "approval" : "executor"];
  return ["reviewer"];
}

function afterResearch(): string { return "planner"; }
function afterPlan(state: AgentStateType): string { return state.requiresApproval ? "approval" : "executor"; }
function afterApproval(state: AgentStateType): string { return state.approvalStatus === "approved" ? "executor" : "reviewer"; }
function afterReview(state: AgentStateType): string {
  return state.needsRevision && state.reviewCount < 2 ? "planner" : END;
}

const workflow = new StateGraph(AgentState)
  .addNode("supervisor", supervisor)
  .addNode("researcher", researcher)
  .addNode("riskAnalyst", riskAnalyst)
  .addNode("planner", planner)
  .addNode("approval", approvalGate)
  .addNode("executor", executor)
  .addNode("reviewer", reviewer)
  .addEdge(START, "supervisor")
  .addConditionalEdges("supervisor", afterSupervisor)
  .addEdge("researcher", "planner")
  .addEdge("riskAnalyst", "planner")
  .addConditionalEdges("planner", afterPlan)
  .addConditionalEdges("approval", afterApproval)
  .addEdge("executor", "reviewer")
  .addConditionalEdges("reviewer", afterReview);

const checkpointer = new MongoDBSaver({ client: mongoClient, dbName: env.MONGODB_DB });
export const agentGraph = workflow.compile({ checkpointer });

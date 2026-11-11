import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { END, START, StateGraph } from "@langchain/langgraph";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { env } from "../config/env.js";
import { mongoClient } from "../db/mongo.js";
import { AgentState, type AgentStateType } from "./state.js";
import { prompts } from "./prompts.js";

const model = new ChatOpenAI({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL, temperature: 0.2, timeout: 60_000, maxRetries: 2 });

async function invokeSpecialist(systemPrompt: string, state: AgentStateType) {
  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage([
      `User request:\n${state.userRequest}`,
      `\nSupervisor brief:\n${state.taskBrief}`,
      `\nResearch findings:\n${state.research || "Not available yet."}`,
      `\nPlan:\n${state.plan || "Not available yet."}`,
      `\nExecution notes:\n${state.execution || "Not available yet."}`
    ].join("\n"))
  ]);
  return typeof response.content === "string" ? response.content : JSON.stringify(response.content);
}

const supervisor = async (state: AgentStateType) => ({ taskBrief: await invokeSpecialist(prompts.supervisor, state) });
const researcher = async (state: AgentStateType) => ({ research: await invokeSpecialist(prompts.researcher, state) });
const planner = async (state: AgentStateType) => ({ plan: await invokeSpecialist(prompts.planner, state) });
const executor = async (state: AgentStateType) => ({ execution: await invokeSpecialist(prompts.executor, state) });
const reviewer = async (state: AgentStateType) => {
  const finalAnswer = await invokeSpecialist(prompts.reviewer, state);
  return { finalAnswer, messages: [new AIMessage(finalAnswer)] };
};

const workflow = new StateGraph(AgentState)
  .addNode("supervisor", supervisor)
  .addNode("researcher", researcher)
  .addNode("planner", planner)
  .addNode("executor", executor)
  .addNode("reviewer", reviewer)
  .addEdge(START, "supervisor")
  .addEdge("supervisor", "researcher")
  .addEdge("researcher", "planner")
  .addEdge("planner", "executor")
  .addEdge("executor", "reviewer")
  .addEdge("reviewer", END);

const checkpointer = new MongoDBSaver({ client: mongoClient, dbName: env.MONGODB_DB });
export const agentGraph = workflow.compile({ checkpointer });

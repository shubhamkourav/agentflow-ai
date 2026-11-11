import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";
import { agentGraph } from "../agents/graph.js";

export const chatRouter = Router();
const bodySchema = z.object({ message: z.string().trim().min(1).max(12_000) });
const safeNodeLabels: Record<string, string> = {
  supervisor: "Understanding your request",
  researcher: "Researching the task",
  planner: "Building an execution plan",
  executor: "Preparing the deliverable",
  reviewer: "Reviewing the final response"
};

chatRouter.post("/threads/:threadId/runs", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const threadId = z.string().uuid().safeParse(req.params.threadId);
  if (!threadId.success) {
    res.status(400).json({ error: "threadId must be a UUID" });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  let disconnected = false;
  res.on("close", () => { if (!res.writableEnded) disconnected = true; });
  const send = (event: string, data: unknown) => {
    if (!disconnected && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send("run.started", { threadId: threadId.data });
    const stream = await agentGraph.stream(
      { userRequest: parsed.data.message, messages: [new HumanMessage(parsed.data.message)] },
      { configurable: { thread_id: threadId.data }, recursionLimit: 20, streamMode: "updates" }
    );
    for await (const update of stream) {
      if (disconnected) break;
      for (const [nodeName, nodeOutput] of Object.entries(update)) {
        const label = safeNodeLabels[nodeName];
        if (!label) continue;
        const output = nodeOutput as Record<string, unknown>;
        send("agent.update", {
          agent: nodeName,
          status: "completed",
          message: label,
          ...(typeof output.finalAnswer === "string" ? { finalAnswer: output.finalAnswer } : {})
        });
      }
    }
    if (!disconnected) {
      const state = await agentGraph.getState({ configurable: { thread_id: threadId.data } });
      send("run.completed", { threadId: threadId.data, answer: state.values.finalAnswer ?? "" });
    }
  } catch (error) {
    send("run.error", { message: error instanceof Error ? error.message : "Agent execution failed" });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

chatRouter.post("/threads", (_req, res) => {
  res.status(201).json({ threadId: randomUUID() });
});

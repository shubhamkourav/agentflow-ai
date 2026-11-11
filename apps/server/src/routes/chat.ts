import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Command } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { agentGraph } from "../agents/graph.js";

export const chatRouter = Router();
const bodySchema = z.object({ message: z.string().trim().min(1).max(12_000) });
const approvalSchema = z.object({
  approved: z.boolean(),
  note: z.string().max(2_000).optional()
});
const threadIdSchema = z.string().uuid();

const safeNodeLabels: Record<string, string> = {
  supervisor: "Understanding your request",
  researcher: "Researching the task",
  riskAnalyst: "Assessing risks and safeguards",
  planner: "Building an execution plan",
  approval: "Waiting for human approval",
  executor: "Preparing the deliverable",
  reviewer: "Reviewing the final response"
};

function threadConfig(threadId: string) {
  return { configurable: { thread_id: threadId }, recursionLimit: 30 };
}

chatRouter.post("/threads/:threadId/runs", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const threadId = threadIdSchema.safeParse(req.params.threadId);
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
      { ...threadConfig(threadId.data), streamMode: "updates" }
    );
    for await (const update of stream) {
      if (disconnected) break;
      for (const [nodeName, nodeOutput] of Object.entries(update)) {
        const label = safeNodeLabels[nodeName];
        if (!label) continue;
        const output = nodeOutput as Record<string, unknown>;
        send("agent.update", {
          agent: nodeName,
          status: nodeName === "approval" ? "waiting" : "completed",
          message: label,
          ...(typeof output.finalAnswer === "string" ? { finalAnswer: output.finalAnswer } : {})
        });
      }
    }

    if (!disconnected) {
      const snapshot = await agentGraph.getState(threadConfig(threadId.data));
      const pendingApproval = snapshot.tasks?.some((task: any) =>
        Array.isArray(task.interrupts) && task.interrupts.length > 0
      );
      if (pendingApproval) {
        const interruptPayload = snapshot.tasks
          ?.flatMap((task: any) => task.interrupts ?? [])
          .map((item: any) => item.value)
          .find((value: unknown) => value && typeof value === "object") ?? {};
        send("run.awaiting_approval", {
          threadId: threadId.data,
          message: "Human approval is required before this workflow can continue.",
          approvalRequired: true,
          details: interruptPayload
        });
      } else {
        send("run.completed", { threadId: threadId.data, answer: snapshot.values.finalAnswer ?? "" });
      }
    }
  } catch (error) {
    send("run.error", { message: error instanceof Error ? error.message : "Agent execution failed" });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

chatRouter.post("/threads/:threadId/approve", async (req, res) => {
  const threadId = threadIdSchema.safeParse(req.params.threadId);
  const parsed = approvalSchema.safeParse(req.body);
  if (!threadId.success) {
    res.status(400).json({ error: "threadId must be a UUID" });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid approval decision", details: parsed.error.flatten() });
    return;
  }

  try {
    const config = threadConfig(threadId.data);
    const snapshot = await agentGraph.getState(config);
    const pendingApproval = snapshot.tasks?.some((task: any) =>
      Array.isArray(task.interrupts) && task.interrupts.length > 0
    );
    if (!pendingApproval) {
      res.status(409).json({ error: "This thread has no pending approval request." });
      return;
    }

    await agentGraph.invoke(
      new Command({ resume: { approved: parsed.data.approved, note: parsed.data.note ?? "" } }),
      config
    );
    const updated = await agentGraph.getState(config);
    res.json({
      threadId: threadId.data,
      approvalStatus: updated.values.approvalStatus,
      answer: updated.values.finalAnswer ?? ""
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unable to resume workflow" });
  }
});

chatRouter.post("/threads", (_req, res) => {
  res.status(201).json({ threadId: randomUUID() });
});

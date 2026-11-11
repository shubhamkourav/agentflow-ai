import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { Command } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { mongoClient } from "../db/mongo.js";
import { env } from "../config/env.js";
import { authenticate } from "../middleware/auth.js";
import { agentGraph } from "../agents/graph.js";

export const chatRouter = Router();
chatRouter.use(authenticate);

const db = () => mongoClient.db(env.MONGODB_DB);
const bodySchema = z.object({ message: z.string().trim().min(1).max(12_000) });
const approvalSchema = z.object({ approved: z.boolean(), note: z.string().max(2_000).optional() });
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

function currentUserId(req: Express.Request) {
  return req.user!.id;
}

async function ownedConversation(threadId: string, ownerId: string) {
  return db().collection("conversations").findOne({ threadId, ownerId });
}

async function audit(ownerId: string, threadId: string, event: string, metadata: Record<string, unknown> = {}) {
  await db().collection("audit_events").insertOne({
    ownerId, threadId, event, metadata, createdAt: new Date()
  });
}

function approvalDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

chatRouter.post("/threads", async (req, res) => {
  const ownerId = currentUserId(req);
  const threadId = randomUUID();
  const now = new Date();
  await db().collection("conversations").insertOne({
    threadId, ownerId, title: "New conversation", messages: [],
    createdAt: now, updatedAt: now
  });
  await audit(ownerId, threadId, "conversation.created");
  res.status(201).json({ threadId });
});

chatRouter.get("/threads", async (req, res) => {
  const ownerId = currentUserId(req);
  const conversations = await db().collection("conversations")
    .find({ ownerId }, { projection: { threadId: 1, title: 1, createdAt: 1, updatedAt: 1 } })
    .sort({ updatedAt: -1 }).limit(100).toArray();
  res.json({ conversations });
});

chatRouter.get("/threads/:threadId", async (req, res) => {
  const parsedId = threadIdSchema.safeParse(req.params.threadId);
  if (!parsedId.success) {
    res.status(400).json({ error: "threadId must be a UUID" });
    return;
  }
  const conversation = await ownedConversation(parsedId.data, currentUserId(req));
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.json({ conversation });
});

chatRouter.post("/threads/:threadId/runs", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  const threadId = threadIdSchema.safeParse(req.params.threadId);
  const ownerId = currentUserId(req);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  if (!threadId.success) {
    res.status(400).json({ error: "threadId must be a UUID" });
    return;
  }
  const conversation = await ownedConversation(threadId.data, ownerId);
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const userMessage = { role: "user", content: parsed.data.message, createdAt: new Date() };
  await db().collection("conversations").updateOne(
    { threadId: threadId.data, ownerId },
    { $push: { messages: userMessage } as never, $set: { updatedAt: new Date(), title: conversation.title === "New conversation" ? parsed.data.message.slice(0, 72) : conversation.title } }
  );
  await audit(ownerId, threadId.data, "run.started");

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
      const interruptValue = snapshot.tasks
        ?.flatMap((task: any) => task.interrupts ?? [])
        .map((item: any) => item.value)
        .find((value: unknown) => value && typeof value === "object");
      if (interruptValue) {
        const actionHash = approvalDigest(interruptValue);
        await db().collection("approval_requests").updateOne(
          { ownerId, threadId: threadId.data },
          { $set: { ownerId, threadId: threadId.data, actionHash, details: interruptValue, status: "pending", createdAt: new Date(), updatedAt: new Date() } },
          { upsert: true }
        );
        await audit(ownerId, threadId.data, "approval.requested", { actionHash });
        send("run.awaiting_approval", {
          threadId: threadId.data,
          message: "Human approval is required before this workflow can continue.",
          approvalRequired: true,
          details: interruptValue
        });
      } else {
        const answer = snapshot.values.finalAnswer ?? "";
        if (answer) {
          await db().collection("conversations").updateOne(
            { threadId: threadId.data, ownerId },
            { $push: { messages: { role: "assistant", content: answer, createdAt: new Date() } } as never, $set: { updatedAt: new Date() } }
          );
        }
        await audit(ownerId, threadId.data, "run.completed");
        send("run.completed", { threadId: threadId.data, answer });
      }
    }
  } catch (error) {
    await audit(ownerId, threadId.data, "run.failed", {
      message: error instanceof Error ? error.message.slice(0, 300) : "Unknown error"
    });
    send("run.error", { message: error instanceof Error ? error.message : "Agent execution failed" });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

chatRouter.post("/threads/:threadId/approve", async (req, res) => {
  const threadId = threadIdSchema.safeParse(req.params.threadId);
  const parsed = approvalSchema.safeParse(req.body);
  const ownerId = currentUserId(req);
  if (!threadId.success) {
    res.status(400).json({ error: "threadId must be a UUID" });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid approval decision", details: parsed.error.flatten() });
    return;
  }
  if (!await ownedConversation(threadId.data, ownerId)) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  try {
    const config = threadConfig(threadId.data);
    const snapshot = await agentGraph.getState(config);
    const interruptValue = snapshot.tasks
      ?.flatMap((task: any) => task.interrupts ?? [])
      .map((item: any) => item.value)
      .find((value: unknown) => value && typeof value === "object");
    if (!interruptValue) {
      res.status(409).json({ error: "This thread has no pending approval request." });
      return;
    }

    const actionHash = approvalDigest(interruptValue);
    const claimed = await db().collection("approval_requests").updateOne(
      { ownerId, threadId: threadId.data, actionHash, status: "pending" },
      { $set: { status: parsed.data.approved ? "approved" : "rejected", decisionNote: parsed.data.note ?? "", decidedAt: new Date(), updatedAt: new Date() } }
    );
    if (claimed.modifiedCount !== 1) {
      res.status(409).json({ error: "This approval is expired, already decided, or no longer matches the pending action." });
      return;
    }

    await audit(ownerId, threadId.data, parsed.data.approved ? "approval.approved" : "approval.rejected", { actionHash });
    try {
      await agentGraph.invoke(
        new Command({ resume: { approved: parsed.data.approved, note: parsed.data.note ?? "" } }),
        config
      );
    } catch (error) {
      await db().collection("approval_requests").updateOne(
        { ownerId, threadId: threadId.data, actionHash },
        { $set: { status: "resume_failed", updatedAt: new Date() } }
      );
      throw error;
    }

    const updated = await agentGraph.getState(config);
    const answer = updated.values.finalAnswer ?? "";
    if (answer) {
      await db().collection("conversations").updateOne(
        { threadId: threadId.data, ownerId },
        { $push: { messages: { role: "assistant", content: answer, createdAt: new Date() } } as never, $set: { updatedAt: new Date() } }
      );
    }
    await db().collection("approval_requests").updateOne(
      { ownerId, threadId: threadId.data, actionHash },
      { $set: { status: "consumed", consumedAt: new Date(), updatedAt: new Date() } }
    );
    await audit(ownerId, threadId.data, "approval.resumed", { actionHash });
    res.json({ threadId: threadId.data, approvalStatus: updated.values.approvalStatus, answer });
  } catch (error) {
    await audit(ownerId, threadId.data, "approval.resume_failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Unable to resume workflow" });
  }
});

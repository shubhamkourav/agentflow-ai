const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type AgentUpdate = { agent: string; status: string; message: string };
export type ApprovalRequest = { threadId: string; message: string; approvalRequired: boolean };

export async function createThread(): Promise<string> {
  const response = await fetch(`${API_URL}/api/threads`, { method: "POST" });
  if (!response.ok) throw new Error("Could not create conversation");
  const data = await response.json() as { threadId: string };
  return data.threadId;
}

export async function approveThread(threadId: string, approved: boolean, note = ""): Promise<{ answer: string; approvalStatus: string }> {
  const response = await fetch(`${API_URL}/api/threads/${threadId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, note })
  });
  const data = await response.json() as { answer?: string; approvalStatus?: string; error?: string };
  if (!response.ok) throw new Error(data.error ?? "Could not submit approval");
  return { answer: data.answer ?? "", approvalStatus: data.approvalStatus ?? "unknown" };
}

export async function streamRun(threadId: string, message: string, handlers: {
  onUpdate: (update: AgentUpdate) => void;
  onComplete: (answer: string) => void;
  onApproval: (request: ApprovalRequest) => void;
  onError: (message: string) => void;
}) {
  const response = await fetch(`${API_URL}/api/threads/${threadId}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
    body: JSON.stringify({ message })
  });
  if (!response.ok || !response.body) throw new Error(`Request failed (${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = frame.match(/^event: (.+)$/m)?.[1];
      const dataLine = frame.match(/^data: (.+)$/m)?.[1];
      if (!event || !dataLine) continue;
      const data = JSON.parse(dataLine) as Record<string, unknown>;
      if (event === "agent.update") handlers.onUpdate(data as unknown as AgentUpdate);
      if (event === "run.completed") handlers.onComplete(String(data.answer ?? ""));
      if (event === "run.awaiting_approval") handlers.onApproval(data as unknown as ApprovalRequest);
      if (event === "run.error") handlers.onError(String(data.message ?? "Unknown error"));
    }
  }
}

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "agentflow.accessToken";

export type User = { id: string; name: string; email: string };
export type Conversation = { threadId: string; title: string; createdAt: string; updatedAt: string };
export type AgentUpdate = { agent: string; status: string; message: string };
export type ApprovalRequest = { threadId: string; message: string; approvalRequired: boolean; details?: { taskBrief?: string; plan?: string } };

export function getAccessToken() { return localStorage.getItem(TOKEN_KEY); }
export function saveAccessToken(token: string) { localStorage.setItem(TOKEN_KEY, token); }
export function clearAccessToken() { localStorage.removeItem(TOKEN_KEY); }

async function request(path: string, init: RequestInit = {}) {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${response.status})`);
  return data;
}

export async function authenticate(mode: "login" | "register", values: { name?: string; email: string; password: string }) {
  const data = await request(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(values) }) as { user: User; accessToken: string };
  saveAccessToken(data.accessToken);
  return data.user;
}

export async function getCurrentUser(): Promise<User> {
  const data = await request("/api/auth/me") as { user: User };
  return data.user;
}

export async function listConversations(): Promise<Conversation[]> {
  const data = await request("/api/threads") as { conversations: Conversation[] };
  return data.conversations;
}

export async function getConversation(threadId: string) {
  const data = await request(`/api/threads/${threadId}`) as { conversation: { messages?: Array<{ role: "user" | "assistant"; content: string }> } };
  return data.conversation;
}

export async function createThread(): Promise<string> {
  const data = await request("/api/threads", { method: "POST" }) as { threadId: string };
  return data.threadId;
}

export async function approveThread(threadId: string, approved: boolean, note = ""): Promise<{ answer: string; approvalStatus: string }> {
  const data = await request(`/api/threads/${threadId}/approve`, {
    method: "POST", body: JSON.stringify({ approved, note })
  }) as { answer?: string; approvalStatus?: string };
  return { answer: data.answer ?? "", approvalStatus: data.approvalStatus ?? "unknown" };
}

export async function streamRun(threadId: string, message: string, handlers: {
  onUpdate: (update: AgentUpdate) => void;
  onComplete: (answer: string) => void;
  onApproval: (request: ApprovalRequest) => void;
  onError: (message: string) => void;
}) {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}/api/threads/${threadId}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ message })
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
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

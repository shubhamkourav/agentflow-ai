import { useEffect, useState, type FormEvent } from "react";
import { Bot, BrainCircuit, CheckCircle2, LoaderCircle, LogOut, Plus, Send, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import {
  approveThread, authenticate, clearAccessToken, createThread, getConversation,
  getCurrentUser, listConversations, streamRun,
  type AgentUpdate, type ApprovalRequest, type Conversation, type User
} from "./api";

type Message = { role: "user" | "assistant"; content: string };
const agents = [
  { id: "supervisor", name: "Supervisor", description: "Routes the request" },
  { id: "researcher", name: "Researcher", description: "Finds and evaluates information" },
  { id: "riskAnalyst", name: "Risk analyst", description: "Checks risks and safeguards" },
  { id: "planner", name: "Planner", description: "Creates an actionable plan" },
  { id: "executor", name: "Executor", description: "Prepares the deliverable" },
  { id: "reviewer", name: "Reviewer", description: "Checks the final response" }
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [threadId, setThreadId] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [updates, setUpdates] = useState<AgentUpdate[]>([]);
  const [busy, setBusy] = useState(false);
  const [approvalPending, setApprovalPending] = useState(false);
  const [approvalDetails, setApprovalDetails] = useState<ApprovalRequest["details"]>({});
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [error, setError] = useState("");

  async function refreshConversations() {
    try { setConversations(await listConversations()); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load conversations"); }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const current = await getCurrentUser();
        if (active) {
          setUser(current);
          setConversations(await listConversations());
        }
      } catch {
        clearAccessToken();
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true); setError("");
    try {
      const signedIn = await authenticate(authMode, { name: authMode === "register" ? name : undefined, email, password });
      setUser(signedIn);
      setPassword("");
      await refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally { setAuthBusy(false); }
  }

  function logout() {
    if (busy || approvalBusy) return;
    clearAccessToken(); setUser(null); setConversations([]); setThreadId("");
    setMessages([]); setUpdates([]); setApprovalPending(false); setApprovalDetails({});
  }

  async function openConversation(id: string) {
    if (busy || approvalBusy || approvalPending) return;
    setError("");
    try {
      const conversation = await getConversation(id);
      setThreadId(id);
      setMessages((conversation.messages ?? []).map((message) => ({ role: message.role, content: message.content })));
      setUpdates([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open conversation");
    }
  }

  async function sendMessage(value = input) {
    const prompt = value.trim();
    if (!prompt || busy || approvalPending) return;
    setBusy(true); setError(""); setUpdates([]);
    setMessages((items) => [...items, { role: "user", content: prompt }]);
    setInput("");
    try {
      const id = threadId || await createThread();
      setThreadId(id);
      await refreshConversations();
      let answer = "";
      await streamRun(id, prompt, {
        onUpdate: (update) => setUpdates((items) => [...items.filter((item) => item.agent !== update.agent), update]),
        onComplete: (result) => { answer = result; },
        onApproval: (request) => { setApprovalPending(true); setApprovalDetails(request.details ?? {}); },
        onError: (message) => setError(message)
      });
      if (answer) setMessages((items) => [...items, { role: "assistant", content: answer }]);
      await refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally { setBusy(false); }
  }

  async function decideApproval(approved: boolean) {
    if (!threadId || approvalBusy) return;
    setApprovalBusy(true); setError("");
    try {
      const result = await approveThread(threadId, approved);
      setApprovalPending(false); setApprovalDetails({});
      if (result.answer) setMessages((items) => [...items, { role: "assistant", content: result.answer }]);
      await refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit approval");
    } finally { setApprovalBusy(false); }
  }

  function newChat() {
    if (busy || approvalBusy || approvalPending) return;
    setThreadId(""); setMessages([]); setUpdates([]); setError(""); setApprovalPending(false); setApprovalDetails({});
  }

  if (authLoading) return <main className="auth-shell"><div className="auth-card"><LoaderCircle className="spin"/> Checking your session…</div></main>;

  if (!user) return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={submitAuth}>
        <div className="brand auth-brand"><div className="brand-icon"><BrainCircuit size={21}/></div><span>AgentFlow<span className="muted">.ai</span></span></div>
        <span className="eyebrow">PRIVATE AI WORKSPACE</span>
        <h1>{authMode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="auth-subtitle">Sign in to access your private conversations and AI team.</p>
        {authMode === "register" && <label>Full name<input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name"/></label>}
        <label>Email address<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label>
        <label>Password<input required type="password" minLength={authMode === "register" ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={authMode === "register" ? "At least 12 characters" : "Your password"}/></label>
        {error && <div className="error auth-error">{error}</div>}
        <button className="auth-submit" disabled={authBusy}>{authBusy ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"}</button>
        <div className="auth-switch">{authMode === "login" ? "New to AgentFlow?" : "Already have an account?"} <button type="button" onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setError(""); }}> {authMode === "login" ? "Create an account" : "Sign in"}</button></div>
        <div className="auth-security"><ShieldCheck size={15}/> Passwords are hashed. API access uses signed tokens.</div>
      </form>
    </main>
  );

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-icon"><BrainCircuit size={21}/></div><span>AgentFlow<span className="muted">.ai</span></span></div>
        <button className="new-chat" onClick={newChat}><Plus size={17}/> New conversation</button>
        <div className="side-label">YOUR CONVERSATIONS</div>
        <div className="conversation-list">
          {conversations.map((conversation) => <button key={conversation.threadId} className={`conversation-link ${threadId === conversation.threadId ? "selected" : ""}`} onClick={() => void openConversation(conversation.threadId)} title={conversation.title}>{conversation.title}</button>)}
          {conversations.length === 0 && <span className="empty-conversations">Your conversations will appear here.</span>}
        </div>
        <div className="side-bottom account-row"><div className="account-avatar">{user.name.slice(0,1).toUpperCase()}</div><div className="account-copy"><strong>{user.name}</strong><span>{user.email}</span></div><button className="logout-button" onClick={logout} title="Sign out"><LogOut size={16}/></button></div>
      </aside>
      <section className="main">
        <header className="topbar"><div><span className="eyebrow">WORKSPACE / AGENTS</span><h1>Multi-agent assistant</h1></div><div className="online"><span className="status-dot"/> Private workspace</div></header>
        <div className="content">
          <section className="chat-panel">
            <div className="conversation">
              {messages.length === 0 ? (
                <div className="welcome">
                  <div className="hero-icon"><Sparkles size={25}/></div>
                  <span className="eyebrow">YOUR AI TEAM IS READY</span>
                  <h2>Complex tasks.<br/><span className="gradient">Collaborative intelligence.</span></h2>
                  <p>Give your team a goal. The supervisor dynamically routes work across research, risk analysis, planning and review.</p>
                  <div className="suggestions">
                    {["Design a scalable React application architecture","Create a 30-day learning roadmap for LangGraph","Review a Node.js API security checklist"].map((item) => <button key={item} onClick={() => void sendMessage(item)}>{item}<span>↗</span></button>)}
                  </div>
                </div>
              ) : (
                <div className="messages">
                  {messages.map((message, index) => <article className={`message ${message.role}`} key={index}>
                    <div className="avatar">{message.role === "user" ? "You" : <Bot size={17}/>}</div>
                    <div><div className="message-role">{message.role === "user" ? "YOU" : "AGENTFLOW"}</div><p>{message.content}</p></div>
                  </article>)}
                  {busy && <div className="working"><LoaderCircle className="spin" size={16}/> Agents are working on your request…</div>}
                  {approvalPending && <section className="approval-card">
                    <div className="approval-title"><ShieldCheck size={18}/><strong>Human approval required</strong></div>
                    <p>Review the proposed action before allowing this workflow to continue. Approval is recorded against your account and the exact pending action.</p>
                    {approvalDetails?.taskBrief && <div className="approval-detail"><strong>Task</strong><p>{approvalDetails.taskBrief}</p></div>}
                    {approvalDetails?.plan && <div className="approval-detail"><strong>Proposed plan</strong><p>{approvalDetails.plan}</p></div>}
                    <div className="approval-actions">
                      <button className="approve-button" disabled={approvalBusy} onClick={() => void decideApproval(true)}><CheckCircle2 size={15}/> Approve workflow</button>
                      <button className="reject-button" disabled={approvalBusy} onClick={() => void decideApproval(false)}><XCircle size={15}/> Reject</button>
                    </div>
                  </section>}
                  {error && <div className="error">{error}</div>}
                </div>
              )}
            </div>
            <div className="composer-wrap">
              <form className="composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
                <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Describe a task for your AI team…" rows={2}/>
                <button disabled={busy || approvalPending || !input.trim()} aria-label="Send message"><Send size={17}/></button>
              </form>
              <div className="composer-foot"><span>AI can make mistakes. Review important outputs.</span><span>ENTER to send · SHIFT + ENTER for newline</span></div>
            </div>
          </section>
          <aside className="agent-panel">
            <div className="panel-heading"><div><span className="eyebrow">ORCHESTRATION</span><h3>Agent activity</h3></div><span className="live-pill">LIVE</span></div>
            <div className="agent-list">
              {agents.map((agent) => {
                const update = updates.find((item) => item.agent === agent.id);
                return <div className="agent-row" key={agent.id}>
                  <div className={`agent-avatar ${update ? "done" : ""}`}>{update ? <CheckCircle2 size={17}/> : <Bot size={17}/>}</div>
                  <div className="agent-info"><strong>{agent.name}</strong><span>{update?.message ?? agent.description}</span></div>
                  <span className={`agent-state ${update ? "complete" : ""}`}>{update ? "Done" : "Idle"}</span>
                </div>;
              })}
            </div>
            <div className="run-card"><span className="eyebrow">CURRENT RUN</span><strong>{busy ? "In progress" : approvalPending ? "Awaiting approval" : threadId ? "Conversation active" : "Waiting for task"}</strong><span>{updates.length} / {agents.length} agents completed</span><div className="progress"><i style={{ width: `${updates.length / agents.length * 100}%` }}/></div></div>
            <div className="architecture-note"><BrainCircuit size={17}/><div><strong>Secure orchestration</strong><p>Private conversation ownership, authenticated approvals, one-time action binding and an audit trail are enabled.</p></div></div>
          </aside>
        </div>
      </section>
    </main>
  );
}

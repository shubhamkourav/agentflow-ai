import { useState } from "react";
import { Bot, BrainCircuit, CheckCircle2, LoaderCircle, Plus, Send, Sparkles, ShieldCheck, XCircle } from "lucide-react";
import { approveThread, createThread, streamRun, type AgentUpdate } from "./api";

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
  const [threadId, setThreadId] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [updates, setUpdates] = useState<AgentUpdate[]>([]);
  const [busy, setBusy] = useState(false);
  const [approvalPending, setApprovalPending] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendMessage(value = input) {
    const prompt = value.trim();
    if (!prompt || busy || approvalPending) return;
    setBusy(true); setError(""); setUpdates([]);
    setMessages((items) => [...items, { role: "user", content: prompt }]);
    setInput("");
    try {
      const id = threadId || await createThread();
      setThreadId(id);
      let answer = "";
      await streamRun(id, prompt, {
        onUpdate: (update) => setUpdates((items) => [...items.filter((item) => item.agent !== update.agent), update]),
        onComplete: (result) => { answer = result; },
        onApproval: () => setApprovalPending(true),
        onError: (message) => setError(message)
      });
      if (answer) setMessages((items) => [...items, { role: "assistant", content: answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally { setBusy(false); }
  }

  async function decideApproval(approved: boolean) {
    if (!threadId || approvalBusy) return;
    setApprovalBusy(true); setError("");
    try {
      const result = await approveThread(threadId, approved);
      setApprovalPending(false);
      if (result.answer) setMessages((items) => [...items, { role: "assistant", content: result.answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit approval");
    } finally { setApprovalBusy(false); }
  }

  function newChat() {
    if (busy || approvalBusy || approvalPending) return;
    setThreadId(""); setMessages([]); setUpdates([]); setError(""); setApprovalPending(false);
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-icon"><BrainCircuit size={21}/></div><span>AgentFlow<span className="muted">.ai</span></span></div>
        <button className="new-chat" onClick={newChat}><Plus size={17}/> New conversation</button>
        <div className="side-label">WORKSPACE</div>
        <div className="nav-item active"><Bot size={17}/> Agent workspace</div>
        <div className="side-bottom"><div className="status-dot"/> Local development environment</div>
      </aside>
      <section className="main">
        <header className="topbar"><div><span className="eyebrow">WORKSPACE / AGENTS</span><h1>Multi-agent assistant</h1></div><div className="online"><span className="status-dot"/> System ready</div></header>
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
                    {["Design a scalable React application architecture","Create a 30-day learning roadmap for LangGraph","Review a Node.js API security checklist"].map((item) => <button key={item} onClick={() => sendMessage(item)}>{item}<span>↗</span></button>)}
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
                    <p>This request may involve a consequential action. Review the proposed plan before allowing the workflow to continue. Approval does not authorize an external action in this starter; no external action tools are connected.</p>
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
            <div className="architecture-note"><BrainCircuit size={17}/><div><strong>Conditional orchestration</strong><p>Research and risk analysis can run in parallel. The reviewer can request one bounded revision pass. MongoDB checkpoints support approval and resume.</p></div></div>
          </aside>
        </div>
      </section>
    </main>
  );
}

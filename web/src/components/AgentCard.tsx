import { useState } from "react";
import type { Agent } from "../api";
import { Panel } from "./Panel";
import { Sprite } from "./Sprite";

export function AgentCard({ agent, onRun, onNewSession, busy, step, revoked }: {
  agent: Agent;
  revoked: boolean;
  onRun: (taskId: string) => void;
  onNewSession: () => void;
  busy: boolean;
  step: string;
}) {
  const [taskId, setTaskId] = useState(agent.tasks[0]?.id ?? "");
  const accent = agent.id === "research-agent" ? "var(--color-sky)" : "var(--color-grape)";
  const s = agent.session;

  return (
    <Panel id={`panel-${agent.id}`} title={`${step} · ${agent.name}`} accent={accent}>
      <div className="flex gap-4">
        <div className="shrink-0">
          <Sprite name={agent.id === "research-agent" ? "research" : "shopping"} size={64} label={agent.name} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-dim">{agent.role}</p>
          {revoked ? (
            <p className="mt-1 text-ruby">
              <span className="px-title bg-ruby px-1.5 py-1 text-[11px] text-night">Access revoked</span> · the owner removed the delegate key. No memory, no spending.
            </p>
          ) : s ? (
            <p className="mt-1">
              Session <b style={{ color: accent }}>#{s.number}</b> · recalled{" "}
              <b style={{ color: accent }}>{s.recalled}</b> memories at start · knows {s.known} now
            </p>
          ) : (
            <p className="mt-1 text-coin">Not started. Memory loads when the session begins.</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="w-full">
          <span className="text-dim">Task</span>
          <select className="px-input mt-1" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            {agent.tasks.map((t) => (
              <option key={t.id} value={t.id}>{t.title} ({t.items} items)</option>
            ))}
          </select>
        </label>
        <button className="px-btn" style={{ ["--b" as string]: accent }} disabled={busy || revoked || !taskId} onClick={() => onRun(taskId)}>
          ▶ Run task
        </button>
        <button className="px-btn" disabled={busy || revoked} onClick={onNewSession} title="Forget everything in RAM and reload from the memory store">
          ↻ New session
        </button>
      </div>
    </Panel>
  );
}

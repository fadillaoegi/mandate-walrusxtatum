import type { AppState } from "../api";
import { Panel } from "./Panel";

export function DelegatePanel({ delegate, onRevoke, onRestore, onCheck, busy }: {
  delegate: AppState["delegate"];
  onRevoke: () => void;
  onRestore: () => void;
  onCheck: () => void;
  busy: boolean;
}) {
  const color = delegate.active ? "var(--color-leaf)" : "var(--color-ruby)";
  const byStore = delegate.revokedBy === "memory_store";
  return (
    <Panel id="panel-delegate" title="6 · Delegate key" accent="var(--color-coin)">
      <p className="text-dim">Every agent you hire reads your memory through this key.</p>
      <p className="mt-2 [overflow-wrap:anywhere]">
        Key: <span className="text-cream">{delegate.delegateId}</span>
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-2">
        Status:
        <span className="px-title px-1.5 py-1 text-[11px] text-night" style={{ background: color }}>
          {delegate.active ? "Active" : byStore ? "Rejected by Walrus" : "Revoked"}
        </span>
      </p>
      {byStore && (
        <p className="mt-1 text-ruby">Walrus refused this key: it was removed from your Memory account. Agents are cut off.</p>
      )}
      {delegate.canCheck && (
        <p className="mt-1 text-sm text-dim">
          {delegate.checkedAt ? `Last checked on Walrus: ${new Date(delegate.checkedAt).toLocaleTimeString()}` : "Not checked on Walrus yet."}
          {" "}Walrus is only asked when you press Check (1 request) or when an agent uses memory.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        {delegate.active ? (
          <button className="px-btn px-btn-ruby" disabled={busy} onClick={onRevoke}>Revoke key</button>
        ) : (
          <button className="px-btn px-btn-leaf" disabled={busy} onClick={onRestore}>
            {byStore ? "Clear (after re-adding key)" : "Restore key (demo)"}
          </button>
        )}
        {delegate.canCheck && (
          <button className="px-btn" disabled={busy} onClick={onCheck} title="Sends one light request to the Walrus relayer">
            Check key on Walrus
          </button>
        )}
      </div>
    </Panel>
  );
}

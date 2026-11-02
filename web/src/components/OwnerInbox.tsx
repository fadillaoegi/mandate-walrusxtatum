import { useState } from "react";
import { type RequestRecord, usd } from "../api";
import { Panel } from "./Panel";

type DecideInput = { approve: boolean; reason: string; tooExpensive: boolean; flagVendor: boolean };

function InboxItem({ r, onDecide, busy }: { r: RequestRecord; onDecide: (id: string, b: DecideInput) => void; busy: boolean }) {
  const [reason, setReason] = useState("");
  const [tooExpensive, setTooExpensive] = useState(false);
  const [flagVendor, setFlagVendor] = useState(false);
  const decide = (approve: boolean) => onDecide(r.id, { approve, reason, tooExpensive, flagVendor });

  return (
    <li className="px-pop bg-panel-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-cream">{r.request.itemTitle}</span>
        <span className="px-money">{usd(r.request.price)}</span>
      </div>
      <p className="text-dim">
        {r.request.vendor} · asked by {r.agentId.replace("-", " ")} · {r.decision.explanation}
      </p>
      <input
        className="px-input mt-2"
        placeholder="Reason (saved to memory)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-label="Reason"
      />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <label className="flex items-center gap-2"><input type="checkbox" checked={tooExpensive} onChange={(e) => setTooExpensive(e.target.checked)} /> Too expensive</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={flagVendor} onChange={(e) => setFlagVendor(e.target.checked)} /> Flag vendor as bad</label>
      </div>
      <div className="mt-3 flex gap-3">
        <button className="px-btn px-btn-leaf" disabled={busy} onClick={() => decide(true)}>Approve</button>
        <button className="px-btn px-btn-ruby" disabled={busy} onClick={() => decide(false)}>Reject</button>
      </div>
    </li>
  );
}

export function OwnerInbox({ pending, onDecide, busy }: { pending: RequestRecord[]; onDecide: (id: string, b: DecideInput) => void; busy: boolean }) {
  return (
    <Panel
      id="panel-inbox"
      title="Owner inbox"
      accent="var(--color-coin)"
      right={pending.length ? <span className="px-title px-blink text-[11px] text-coin">{pending.length} new!</span> : null}
    >
      {pending.length === 0 ? (
        <p className="text-dim">Nothing to approve. Agents only ask about things memory can't decide.</p>
      ) : (
        <ul className="space-y-4">
          {pending.map((r) => <InboxItem key={r.id} r={r} onDecide={onDecide} busy={busy} />)}
        </ul>
      )}
    </Panel>
  );
}

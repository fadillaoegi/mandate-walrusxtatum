import type { AuditFinding } from "../api";
import { Panel } from "./Panel";

export function ChainPanel({ chainLabel, railLabel, x402, failNextSupported, failNext, onFailNext, overchargeNext, onOvercharge, onAudit, findings, busy }: {
  chainLabel: string;
  railLabel: string;
  x402: boolean;
  failNextSupported: boolean;
  failNext: boolean;
  onFailNext: (v: boolean) => void;
  overchargeNext: boolean;
  onOvercharge: (v: boolean) => void;
  onAudit: () => void;
  findings: AuditFinding[] | null;
  busy: boolean;
}) {
  const corrected = findings?.filter((f) => f.corrected).length ?? 0;
  return (
    <Panel id="panel-chain" title="5 · Payments & on-chain truth" accent="var(--color-grape)">
      <p className="text-dim">
        Pays with <span className="text-cream">{railLabel}</span>.
      </p>
      <p className="text-dim" title="If the chain disagrees with memory, the chain wins and a correction memory is written.">
        Checked by <span className="text-cream">{chainLabel}</span>. The chain wins over memory.
      </p>
      {failNextSupported && (
        <label className="mt-3 flex items-center gap-2 bg-panel-2 p-2">
          <input type="checkbox" checked={failNext} disabled={busy} onChange={(e) => onFailNext(e.target.checked)} />
          <span>
            <span className="px-title text-[11px] text-coin">Demo control</span>{" "}
            {x402 ? "Merchant says “paid”, but the next tx fails on-chain" : "Make the next payment fail on-chain"}
          </span>
        </label>
      )}
      {x402 && (
        <label className="mt-2 flex items-center gap-2 bg-panel-2 p-2">
          <input type="checkbox" checked={overchargeNext} disabled={busy} onChange={(e) => onOvercharge(e.target.checked)} />
          <span>
            <span className="px-title text-[11px] text-coin">Demo control</span> Greedy merchant: next HTTP 402 asks $0.10 more
          </span>
        </label>
      )}
      <div className="mt-3">
        <button className="px-btn" style={{ ["--b" as string]: "var(--color-grape)" }} disabled={busy} onClick={onAudit}>
          Audit receipts
        </button>
      </div>
      {findings && (
        <div className="px-pop mt-3">
          <p>
            Checked <b>{findings.length}</b> receipts ·{" "}
            <b className={corrected ? "text-ruby" : "text-leaf"}>{corrected} corrected</b>
          </p>
          <ul className="mt-1 space-y-1 text-dim">
            {findings.map((f) => (
              <li key={f.digest} className="[overflow-wrap:anywhere]">
                {f.itemId}: memory said <span className="text-cream">{f.remembered}</span>, chain says{" "}
                <span className={f.onChain === "verified" ? "text-leaf" : "text-ruby"}>{f.onChain}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

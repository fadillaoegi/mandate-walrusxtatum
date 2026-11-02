import { useState } from "react";
import { type MemoryEntry, memorySentence, shortId } from "../api";
import { Panel } from "./Panel";
import { Sprite } from "./Sprite";

const KIND: Record<string, { label: string; color: string }> = {
  mandate_set: { label: "RULE", color: "var(--color-coin)" },
  owner_verdict: { label: "VERDICT", color: "var(--color-sky)" },
  vendor_flag: { label: "FLAG", color: "var(--color-ruby)" },
  purchase_recorded: { label: "RECEIPT", color: "var(--color-leaf)" },
  purchase_status: { label: "ON-CHAIN", color: "var(--color-grape)" },
};

export function MemoryPanel({ memories, storeLabel, isWalrus, namespace, busy, onRetry }: {
  memories: MemoryEntry[];
  storeLabel: string;
  isWalrus: boolean;
  namespace: string;
  busy: boolean;
  onRetry: () => void;
}) {
  const goal = 10;
  const stored = memories.filter((m) => m.status === "stored").length;
  const pending = memories.filter((m) => m.status === "pending").length;
  const failed = memories.filter((m) => m.status === "failed").length;
  const filled = Math.min(stored, goal);
  return (
    <Panel id="panel-memory" title="Memory vault" accent="var(--color-leaf)" right={<Sprite name="chest" size={36} label="Memory vault" />}>
      <p className="text-dim">Store: <span className="text-cream">{storeLabel}</span></p>
      <p className="text-dim">Namespace: <span className="text-cream [overflow-wrap:anywhere]">{namespace}</span></p>
      <div className="mt-2 flex flex-wrap items-center gap-2" aria-label={`${stored} memories stored`}>
        <div className="flex gap-1">
          {Array.from({ length: goal }, (_, i) => (
            <span key={i} className="inline-block h-3 w-3" style={{ background: i < filled ? "var(--color-leaf)" : "var(--color-panel-2)" }} />
          ))}
        </div>
        <span className="px-title text-[11px] text-leaf">{stored} stored</span>
        {pending > 0 && <span className="px-title px-blink text-[11px] text-coin">{pending} writing…</span>}
        {failed > 0 && <span className="px-title text-[11px] text-ruby">{failed} failed</span>}
      </div>
      {failed > 0 && (
        <button className="px-btn px-btn-ruby mt-2" disabled={busy} onClick={onRetry}>Retry failed writes</button>
      )}
      {memories.length === 0 && (
        <p className="mt-3 text-dim">Empty. Save the mandate (step 1) and every rule, verdict and receipt lands here.</p>
      )}
      <ol className="mt-3 max-h-[440px] space-y-2 overflow-y-auto pr-1">
        {[...memories].reverse().map((m) => {
          const isCorrection = m.event.kind === "purchase_status" && (m.event as { status?: string }).status === "failed";
          const k = isCorrection
            ? { label: "CORRECTION", color: "var(--color-ruby)" }
            : (KIND[m.event.kind] ?? { label: m.event.kind, color: "var(--color-dim)" });
          return (
            <li key={m.ref} className="bg-panel-2 p-2" style={m.status === "pending" ? { opacity: 0.75 } : undefined}>
              <div className="flex items-center gap-2">
                <span className="px-title px-1 py-0.5 text-[11px] text-night" style={{ background: k.color }}>{k.label}</span>
                <span className="text-dim">by {m.writtenBy.replace("-", " ")}</span>
              </div>
              <p className="mt-1 [overflow-wrap:anywhere]">{memorySentence(m.text)}</p>
              <p className="px-id mt-1 flex flex-wrap items-center gap-2">
                {m.status === "pending" ? (
                  <span className="px-blink text-coin">{isWalrus ? "writing to Walrus… (~20 s)" : "writing…"}</span>
                ) : m.status === "failed" ? (
                  <span className="text-ruby" title={m.error ?? ""}>write failed: {m.error}</span>
                ) : (
                  <>
                    blob{" "}
                    {isWalrus ? (
                      <a className="text-sky underline" href={`https://walruscan.com/mainnet/blob/${m.blobId}`} target="_blank" rel="noreferrer" title={m.blobId ?? ""}>
                        {shortId(m.blobId ?? "")} ↗
                      </a>
                    ) : (
                      <span title={m.blobId ?? ""}>{shortId(m.blobId ?? "")}</span>
                    )}
                    <CopyButton value={m.blobId ?? ""} />
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="text-dim underline decoration-dotted hover:text-cream"
      aria-label="Copy blob id"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

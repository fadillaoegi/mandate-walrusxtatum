import { type RequestRecord, shortId, usd } from "../api";
import { Panel, StatusTag } from "./Panel";

export function Timeline({ requests }: { requests: RequestRecord[] }) {
  const rows = [...requests].reverse();
  return (
    <Panel id="panel-log" title="Decision log" accent="var(--color-sky)" right={<span className="text-dim">{requests.length} requests</span>}>
      {rows.length === 0 ? (
        <p className="text-dim">Run an agent task to see decisions here.</p>
      ) : (
        <ol className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
          {rows.map((r) => (
            <li key={r.id} className="bg-panel-2 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusTag status={r.status} />
                {r.payment?.status === "failed" && !r.payment.error && (
                  <span className="px-title px-1.5 py-1 text-[11px] text-night" style={{ background: "var(--color-ruby)" }}>Payment failed</span>
                )}
                {r.payment?.error && (
                  <span className="px-title px-1.5 py-1 text-[11px] text-night" style={{ background: "var(--color-coin)" }}>Refused to pay</span>
                )}
                {r.payment?.status === "unknown" && (
                  <span className="px-title px-1.5 py-1 text-[11px] text-night" style={{ background: "var(--color-coin)" }}>Awaiting chain</span>
                )}
                <span className="text-cream">{r.request.itemTitle}</span>
                <span className="text-dim">{r.request.vendor}</span>
                <span className="px-money">{usd(r.request.price)}</span>
              </div>
              <p className="mt-1">{r.ownerReason ? `Owner: ${r.ownerReason}` : r.decision.explanation}</p>
              <p className="mt-1 text-sm text-dim [overflow-wrap:anywhere]">
                {r.agentId.replace("-", " ")} · session #{r.sessionNumber} · used {r.memoriesUsed} memories
                {" · "}without memory: <span className="text-coin">would ask owner</span>
                {r.payment && !r.payment.error && (
                  <>
                    {" · "}{r.payment.status === "verified" ? "paid" : "submitted"} via {r.payment.rail === "A" ? "x402" : `rail ${r.payment.rail}`} ({r.payment.network})
                    {r.payment.digest && (
                      <>
                        {" "}tx{" "}
                        {r.payment.network === "sui:testnet" || r.payment.network === "sui:mainnet" ? (
                          <a className="text-sky underline" href={`https://suiscan.xyz/${r.payment.network.slice(4)}/tx/${r.payment.digest}`} target="_blank" rel="noreferrer" title={r.payment.digest}>
                            {shortId(r.payment.digest)} ↗
                          </a>
                        ) : (
                          <span className="text-cream" title={r.payment.digest}>{shortId(r.payment.digest)}</span>
                        )}
                      </>
                    )},{" "}
                    <span className={r.payment.status === "verified" ? "text-leaf" : "text-ruby"}>{r.payment.status}</span> by {r.payment.checkedBy}
                  </>
                )}
              </p>
              {r.payment?.error && (
                <p className="mt-1 text-sm text-ruby">Not paid: {r.payment.error}</p>
              )}
              {r.payment?.verificationError && (
                <p className="mt-1 text-sm text-coin">{r.payment.verificationError}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

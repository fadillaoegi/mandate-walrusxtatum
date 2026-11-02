import type { RequestRecord } from "../api";
import { Panel } from "./Panel";

export function Comparison({ requests }: { requests: RequestRecord[] }) {
  const n = requests.length;
  const asked = requests.filter((r) => r.decision.verdict === "ask_owner").length;
  const count = (...reasons: string[]) => requests.filter((r) => reasons.includes(r.decision.reason)).length;

  const rows: [string, string | number, string | number][] = [
    ["Purchase requests", n, n],
    ["Owner had to decide", n, asked],
    ["Decided from memory", 0, n - asked],
    ["Duplicate purchases blocked", 0, count("DUPLICATE_PURCHASE")],
    ["Blocked / flagged vendors stopped", 0, count("BLOCKED_VENDOR", "FLAGGED_VENDOR")],
    ["Over budget / too expensive stopped", 0, count("OVER_ITEM_LIMIT", "OVER_DAILY_LIMIT", "LEARNED_PRICE_CEILING")],
  ];

  return (
    <Panel id="panel-compare" title="Without memory vs with Mandate" accent="var(--color-grape)">
      {n === 0 && <p className="mb-2 text-dim">Fills in as agents run. Start with the guided demo above.</p>}
      <table className="w-full border-separate border-spacing-y-1 text-left">
        <thead>
          <tr className="px-title text-[11px] text-dim">
            <th className="pb-2 font-normal" />
            <th className="pb-2 font-normal">Without memory</th>
            <th className="pb-2 font-normal text-grape">With Mandate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label} className="bg-panel-2">
              <td className="px-2 py-1">{label}</td>
              <td className="px-2 py-1 text-dim">{a}</td>
              <td className="px-2 py-1 text-cream"><b>{b}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm text-dim">
        "Without memory" = the same agent and policy with an empty memory, which has to ask the owner about every request.
      </p>
    </Panel>
  );
}

import { useEffect, useState } from "react";
import { type Rules, usd } from "../api";
import { Panel } from "./Panel";
import { Sprite } from "./Sprite";

export function MandatePanel({ mandate, onSave, busy }: {
  mandate: Rules | null;
  onSave: (b: { maxPerItemUsd: number; maxPerDayUsd: number; blockedVendors: string[] }) => void;
  busy: boolean;
}) {
  const [item, setItem] = useState("0.50");
  const [day, setDay] = useState("2.00");
  const [blocked, setBlocked] = useState("ShadyData");

  useEffect(() => {
    if (!mandate) return;
    setItem((mandate.maxPerItem / 1e6).toFixed(2));
    setDay((mandate.maxPerDay / 1e6).toFixed(2));
    setBlocked(mandate.blockedVendors.join(", "));
  }, [mandate]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      maxPerItemUsd: Number(item),
      maxPerDayUsd: Number(day),
      blockedVendors: blocked.split(",").map((v) => v.trim()).filter(Boolean),
    });
  };

  return (
    <Panel id="panel-mandate" title="1 · Owner mandate" accent="var(--color-coin)" right={<Sprite name="owner" size={36} label="Owner" />}>
      {mandate ? (
        <p className="mb-3 text-dim">
          In memory: max <b className="px-money">{usd(mandate.maxPerItem)}</b>/item,{" "}
          <b className="px-money">{usd(mandate.maxPerDay)}</b>/day, blocked:{" "}
          <b className="text-cream">{mandate.blockedVendors.join(", ") || "none"}</b>
        </p>
      ) : (
        <p className="mb-3 text-coin">No mandate yet. Agents will ask you about everything.</p>
      )}
      <form onSubmit={submit} className="grid grid-cols-2 gap-x-4 gap-y-3">
        <label className="block">
          <span className="text-dim">Max per item ($)</span>
          <input className="px-input mt-1" inputMode="decimal" value={item} onChange={(e) => setItem(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-dim">Max per day ($)</span>
          <input className="px-input mt-1" inputMode="decimal" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="col-span-2 block">
          <span className="text-dim">Blocked vendors (comma separated)</span>
          <input className="px-input mt-1" value={blocked} onChange={(e) => setBlocked(e.target.value)} />
        </label>
        <div className="col-span-2 pt-1">
          <button className="px-btn px-btn-coin" disabled={busy}>Save to memory</button>
        </div>
      </form>
    </Panel>
  );
}

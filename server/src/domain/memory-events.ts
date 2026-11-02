import {
  type Knowledge,
  type MandateRules,
  type MicroUsd,
  type PurchaseStatus,
  emptyKnowledge,
  formatUsd,
} from "./model.js";

/**
 * Every memory written to Walrus is one immutable event. Walrus Memory is
 * append-only, so corrections are new events that supersede older ones;
 * knowledge is rebuilt by folding events in time order.
 */
export type MemoryEvent =
  | { kind: "mandate_set"; at: string; rules: MandateRules }
  | {
      kind: "owner_verdict";
      at: string;
      vendor: string;
      itemId: string;
      price: MicroUsd;
      verdict: "approved" | "rejected";
      reason: string;
      tooExpensive: boolean;
    }
  | { kind: "vendor_flag"; at: string; vendor: string; reason: string }
  | {
      kind: "purchase_recorded";
      at: string;
      itemId: string;
      vendor: string;
      price: MicroUsd;
      digest: string | null;
    }
  | {
      kind: "purchase_status";
      at: string;
      itemId: string;
      digest: string | null;
      status: PurchaseStatus;
      source: string;
    };

const TAG = "[mandate:v1]";
const SEP = " || ";

/** Human-readable sentence first (helps semantic recall), JSON payload after. */
export function describe(event: MemoryEvent): string {
  switch (event.kind) {
    case "mandate_set":
      return `Owner spending mandate: max ${formatUsd(event.rules.maxPerItem)} per item, ${formatUsd(event.rules.maxPerDay)} per day, blocked vendors: ${event.rules.blockedVendors.join(", ") || "none"}.`;
    case "owner_verdict":
      return `Owner ${event.verdict} ${formatUsd(event.price)} purchase of ${event.itemId} from ${event.vendor}: ${event.reason}.`;
    case "vendor_flag":
      return `Vendor ${event.vendor} flagged as bad: ${event.reason}.`;
    case "purchase_recorded":
      return `Purchased ${event.itemId} from ${event.vendor} for ${formatUsd(event.price)}${event.digest ? ` (tx ${event.digest})` : ""}.`;
    case "purchase_status":
      return `Purchase of ${event.itemId} is ${event.status} according to ${event.source}${event.digest ? ` (tx ${event.digest})` : ""}.`;
  }
}

export function encode(event: MemoryEvent): string {
  return `${TAG} ${describe(event)}${SEP}${JSON.stringify(event)}`;
}

export function decode(text: string): MemoryEvent | null {
  if (!text.startsWith(TAG)) return null;
  // The payload always starts with `{"kind":` because encode() puts kind first.
  const idx = text.indexOf(`${SEP}{"kind":`);
  if (idx < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(idx + SEP.length)) as MemoryEvent;
    return typeof parsed?.kind === "string" && typeof parsed?.at === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function fold(events: MemoryEvent[]): Knowledge {
  const k = emptyKnowledge();
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  for (const e of sorted) {
    switch (e.kind) {
      case "mandate_set":
        k.rules = e.rules;
        break;
      case "owner_verdict":
        k.ownerVerdicts.push({
          vendor: e.vendor,
          itemId: e.itemId,
          price: e.price,
          verdict: e.verdict,
          reason: e.reason,
          tooExpensive: e.tooExpensive,
          at: e.at,
        });
        break;
      case "vendor_flag":
        k.vendorFlags.push({ vendor: e.vendor, reason: e.reason });
        break;
      case "purchase_recorded":
        k.purchases.push({
          itemId: e.itemId,
          vendor: e.vendor,
          price: e.price,
          digest: e.digest,
          status: "pending",
          at: e.at,
        });
        break;
      case "purchase_status": {
        const p = [...k.purchases]
          .reverse()
          .find((x) => x.itemId === e.itemId && (e.digest === null || x.digest === e.digest));
        if (p) p.status = e.status;
        break;
      }
    }
  }
  return k;
}

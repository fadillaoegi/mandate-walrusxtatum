import { describe, expect, it } from "vitest";
import { type Knowledge, type PurchaseRequest, emptyKnowledge, usd } from "../src/domain/model.js";
import { evaluate } from "../src/domain/policy.js";
import { type MemoryEvent, decode, encode, fold } from "../src/domain/memory-events.js";

const DAY = "2026-11-03T10:00:00.000Z";
const rules = { maxPerItem: usd(0.5), maxPerDay: usd(2), blockedVendors: ["ShadyData"] };

const req = (over: Partial<PurchaseRequest> = {}): PurchaseRequest => ({
  id: "r1",
  agentId: "research-agent",
  vendor: "OpenStats",
  itemId: "report-1",
  itemTitle: "Report 1",
  price: usd(0.2),
  requestedAt: DAY,
  ...over,
});

const withRules = (over: Partial<Knowledge> = {}): Knowledge => ({
  ...emptyKnowledge(),
  rules,
  ...over,
});

const approvedOpenStats = {
  vendor: "OpenStats",
  itemId: "report-0",
  price: usd(0.1),
  verdict: "approved" as const,
  reason: "useful",
  tooExpensive: false,
  at: DAY,
};

describe("evaluate", () => {
  it("asks the owner when no mandate is remembered", () => {
    expect(evaluate(req(), emptyKnowledge()).reason).toBe("NO_MANDATE");
  });

  it("rejects blocked vendors case-insensitively", () => {
    const d = evaluate(req({ vendor: "shadydata" }), withRules());
    expect(d).toMatchObject({ verdict: "reject", reason: "BLOCKED_VENDOR" });
  });

  it("rejects vendors flagged in memory", () => {
    const d = evaluate(req(), withRules({ vendorFlags: [{ vendor: "OpenStats", reason: "stale data" }] }));
    expect(d.reason).toBe("FLAGGED_VENDOR");
  });

  it("rejects duplicates unless the earlier purchase failed on-chain", () => {
    const purchase = { itemId: "report-1", vendor: "OpenStats", price: usd(0.2), digest: "abc", at: DAY };
    expect(evaluate(req(), withRules({ purchases: [{ ...purchase, status: "verified" }] })).reason).toBe(
      "DUPLICATE_PURCHASE",
    );
    expect(
      evaluate(req(), withRules({ purchases: [{ ...purchase, status: "failed" }], ownerVerdicts: [approvedOpenStats] }))
        .verdict,
    ).toBe("approve");
  });

  it("enforces the per-item limit", () => {
    expect(evaluate(req({ price: usd(0.51) }), withRules()).reason).toBe("OVER_ITEM_LIMIT");
  });

  it("enforces the daily limit, ignoring failed and other-day purchases", () => {
    const p = (itemId: string, price: number, status: "verified" | "failed", at = DAY) => ({
      itemId, vendor: "OpenStats", price: usd(price), digest: null, status, at,
    });
    const k = withRules({ purchases: [p("a", 0.5, "verified"), p("b", 0.5, "verified"), p("c", 0.5, "verified"), p("d", 0.5, "failed"), p("e", 0.5, "verified", "2026-11-02T10:00:00.000Z")], ownerVerdicts: [approvedOpenStats] });
    expect(evaluate(req({ price: usd(0.5) }), k).verdict).toBe("approve"); // 1.50 + 0.50 = 2.00
    expect(evaluate(req({ price: usd(0.5) }), withRules({ ...k, purchases: [...k.purchases, p("f", 0.01, "verified")] })).reason).toBe(
      "OVER_DAILY_LIMIT",
    );
  });

  it("applies a learned price ceiling from 'too expensive' rejections", () => {
    const k = withRules({
      ownerVerdicts: [approvedOpenStats, { ...approvedOpenStats, itemId: "x", price: usd(0.4), verdict: "rejected", tooExpensive: true }],
    });
    expect(evaluate(req({ price: usd(0.45) }), k).reason).toBe("LEARNED_PRICE_CEILING");
    expect(evaluate(req({ price: usd(0.3) }), k).verdict).toBe("approve");
  });

  it("auto-approves trusted vendors and asks about new ones", () => {
    expect(evaluate(req(), withRules()).verdict).toBe("ask_owner");
    expect(evaluate(req(), withRules({ ownerVerdicts: [approvedOpenStats] })).verdict).toBe("approve");
  });
});

describe("memory events", () => {
  it("round-trips through the Walrus text encoding", () => {
    const e: MemoryEvent = { kind: "vendor_flag", at: DAY, vendor: "X || Y", reason: "bad" };
    expect(decode(encode(e))).toEqual(e);
    expect(decode("random note")).toBeNull();
  });

  it("folds a later on-chain failure into the purchase record", () => {
    const k = fold([
      { kind: "purchase_status", at: "2026-11-03T11:00:00.000Z", itemId: "r", digest: "d1", status: "failed", source: "Tatum Sui RPC" },
      { kind: "purchase_recorded", at: DAY, itemId: "r", vendor: "V", price: usd(0.1), digest: "d1" },
      { kind: "mandate_set", at: DAY, rules },
    ]);
    expect(k.rules).toEqual(rules);
    expect(k.purchases[0]?.status).toBe("failed");
  });
});

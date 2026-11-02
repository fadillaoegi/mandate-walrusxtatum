import {
  type Decision,
  type Knowledge,
  type MicroUsd,
  type PurchaseRequest,
  formatUsd,
} from "./model.js";

const sameUtcDay = (a: string, b: string): boolean => a.slice(0, 10) === b.slice(0, 10);
const norm = (vendor: string): string => vendor.trim().toLowerCase();

/** Spend that counts against today's limit: anything not proven failed on-chain. */
export function spentOn(knowledge: Knowledge, isoDay: string): MicroUsd {
  return knowledge.purchases
    .filter((p) => p.status !== "failed" && sameUtcDay(p.at, isoDay))
    .reduce((sum, p) => sum + p.price, 0);
}

/**
 * The lowest price the owner has rejected as "too expensive".
 * Requests at or above it are rejected without asking again.
 */
export function learnedPriceCeiling(knowledge: Knowledge): MicroUsd | null {
  const prices = knowledge.ownerVerdicts
    .filter((v) => v.verdict === "rejected" && v.tooExpensive)
    .map((v) => v.price);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * Deterministic spending policy. An LLM may suggest purchases, but every
 * request passes through this function and nothing can override a hard rule.
 *
 * Order matters: hard owner rules first, then remembered experience, then
 * the trust check that decides between auto-approve and asking the owner.
 */
export function evaluate(request: PurchaseRequest, knowledge: Knowledge): Decision {
  const rules = knowledge.rules;
  if (!rules) {
    return {
      verdict: "ask_owner",
      reason: "NO_MANDATE",
      explanation: "No mandate found in memory; the owner must decide.",
    };
  }

  const vendor = norm(request.vendor);

  if (rules.blockedVendors.some((v) => norm(v) === vendor)) {
    return {
      verdict: "reject",
      reason: "BLOCKED_VENDOR",
      explanation: `${request.vendor} is blocked by the owner's mandate.`,
    };
  }

  const flag = knowledge.vendorFlags.find((f) => norm(f.vendor) === vendor);
  if (flag) {
    return {
      verdict: "reject",
      reason: "FLAGGED_VENDOR",
      explanation: `${request.vendor} was flagged before: ${flag.reason}`,
    };
  }

  const previous = knowledge.purchases.find(
    (p) => p.itemId === request.itemId && p.status !== "failed",
  );
  if (previous) {
    return {
      verdict: "reject",
      reason: "DUPLICATE_PURCHASE",
      explanation: previous.digest
        ? `Already bought "${request.itemTitle}" (tx ${previous.digest.slice(0, 10)}…).`
        : `Already bought "${request.itemTitle}".`,
    };
  }

  if (request.price > rules.maxPerItem) {
    return {
      verdict: "reject",
      reason: "OVER_ITEM_LIMIT",
      explanation: `${formatUsd(request.price)} exceeds the ${formatUsd(rules.maxPerItem)} per-item limit.`,
    };
  }

  const spent = spentOn(knowledge, request.requestedAt);
  if (spent + request.price > rules.maxPerDay) {
    return {
      verdict: "reject",
      reason: "OVER_DAILY_LIMIT",
      explanation: `Spent ${formatUsd(spent)} today; ${formatUsd(request.price)} more would pass the ${formatUsd(rules.maxPerDay)} daily limit.`,
    };
  }

  const ceiling = learnedPriceCeiling(knowledge);
  if (ceiling !== null && request.price >= ceiling) {
    return {
      verdict: "reject",
      reason: "LEARNED_PRICE_CEILING",
      explanation: `The owner rejected ${formatUsd(ceiling)} as too expensive before.`,
    };
  }

  const trusted = knowledge.ownerVerdicts.some(
    (v) => v.verdict === "approved" && norm(v.vendor) === vendor,
  );
  if (trusted) {
    return {
      verdict: "approve",
      reason: "TRUSTED_VENDOR_WITHIN_LIMITS",
      explanation: `Owner approved ${request.vendor} before and this is within every limit.`,
    };
  }

  return {
    verdict: "ask_owner",
    reason: "UNKNOWN_VENDOR_NEEDS_OWNER",
    explanation: `First purchase from ${request.vendor}; asking the owner.`,
  };
}

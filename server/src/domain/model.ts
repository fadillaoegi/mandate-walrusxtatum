/**
 * Core domain model. Pure types, no I/O.
 *
 * Money is stored as integer micro-USD (1 USD = 1_000_000), matching the
 * 6 decimals of USDC so amounts never go through floating point.
 */
export type MicroUsd = number;

export const usd = (dollars: number): MicroUsd => Math.round(dollars * 1_000_000);
export const formatUsd = (amount: MicroUsd): string => `$${(amount / 1_000_000).toFixed(2)}`;

export interface MandateRules {
  maxPerItem: MicroUsd;
  maxPerDay: MicroUsd;
  blockedVendors: string[];
}

export interface PurchaseRequest {
  id: string;
  agentId: string;
  vendor: string;
  itemId: string;
  itemTitle: string;
  price: MicroUsd;
  requestedAt: string; // ISO timestamp
}

/** Things the agent has learned, rebuilt from Walrus memories. */
export interface VendorFlag {
  vendor: string;
  reason: string;
}

export type PurchaseStatus = "pending" | "verified" | "failed";

export interface PurchaseRecord {
  itemId: string;
  vendor: string;
  price: MicroUsd;
  digest: string | null;
  status: PurchaseStatus;
  at: string;
}

export interface OwnerVerdict {
  vendor: string;
  itemId: string;
  price: MicroUsd;
  verdict: "approved" | "rejected";
  reason: string;
  /** Set when the owner rejects because the price was too high. */
  tooExpensive: boolean;
  at: string;
}

export interface Knowledge {
  rules: MandateRules | null;
  vendorFlags: VendorFlag[];
  purchases: PurchaseRecord[];
  ownerVerdicts: OwnerVerdict[];
}

export const emptyKnowledge = (): Knowledge => ({
  rules: null,
  vendorFlags: [],
  purchases: [],
  ownerVerdicts: [],
});

export type ReasonCode =
  | "NO_MANDATE"
  | "BLOCKED_VENDOR"
  | "FLAGGED_VENDOR"
  | "DUPLICATE_PURCHASE"
  | "OVER_ITEM_LIMIT"
  | "OVER_DAILY_LIMIT"
  | "LEARNED_PRICE_CEILING"
  | "TRUSTED_VENDOR_WITHIN_LIMITS"
  | "UNKNOWN_VENDOR_NEEDS_OWNER";

export type Verdict = "approve" | "reject" | "ask_owner";

export interface Decision {
  verdict: Verdict;
  reason: ReasonCode;
  explanation: string;
}

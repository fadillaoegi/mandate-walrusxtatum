import type { MicroUsd } from "../domain/model.js";

/** What Mandate approved: the agent may pay at most this, for this item, to this vendor. */
export interface PaymentRequirement {
  /** Agent that pays (each agent has its own wallet). */
  payer: string;
  vendor: string;
  /** Catalog item id; the merchant serves it at a resource URL. */
  resource: string;
  amount: MicroUsd;
}

export interface PaymentProof {
  rail: "A" | "B" | "C" | "D";
  network: string;
  /** Transaction digest the merchant reports; Mandate still checks it on chain. */
  digest: string | null;
  /** Payer address, when the rail has one. */
  payer?: string | null;
}

/** The rail refused or failed to pay; nothing was charged. */
export class PaymentRefusedError extends Error {}

/** How an agent actually pays. Swappable without touching the domain. */
export interface PaymentRail {
  readonly id: PaymentProof["rail"];
  /** Shown to users, e.g. "x402 on Sui (localnet ledger)". */
  readonly label: string;
  pay(requirement: PaymentRequirement): Promise<PaymentProof>;
}

/** Demo control shared by rails/settlers: make the next settlement fail on chain. */
export interface FailNextControl {
  /** False on a real chain: a valid transaction cannot be made to fail on purpose. */
  readonly failNextSupported: boolean;
  setFailNext(value: boolean): void;
  willFailNext(): boolean;
}

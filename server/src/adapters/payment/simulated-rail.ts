import { randomBytes } from "node:crypto";
import type { Db } from "../persistence/db.js";
import type { FailNextControl, PaymentProof, PaymentRail, PaymentRequirement } from "../../ports/payment-rail.js";
import type { ChainReader, SuiTxSummary } from "../../ports/chain-reader.js";

/**
 * Rail D: a clearly labelled simulated ledger. No funds move. The matching
 * chain reader lets the app run its verify-then-trust flow without a network.
 */
export class SimulatedRail implements PaymentRail, FailNextControl {
  readonly id = "D" as const;
  readonly label = "Rail D (simulated, no funds move)";
  readonly failNextSupported = true;
  /** Demo control: the next payment lands on the ledger as a failed transaction. */
  private failNext = false;
  constructor(private readonly db: Db) {}

  setFailNext(value: boolean) {
    this.failNext = value;
  }

  willFailNext() {
    return this.failNext;
  }

  async pay(req: PaymentRequirement): Promise<PaymentProof> {
    const digest = `sim${randomBytes(16).toString("hex")}`;
    const status = this.failNext ? "failure" : "success";
    this.failNext = false;
    await this.db.query("insert into local_ledger (digest, status, amount, pay_to) values ($1, $2, $3, $4)", [
      digest,
      status,
      req.amount,
      req.vendor,
    ]);
    return { rail: "D", network: "simulated", digest };
  }
}

export class SimulatedChainReader implements ChainReader {
  readonly source = "Simulated ledger (dev only)";
  constructor(private readonly db: Db) {}

  async getTransaction(digest: string): Promise<SuiTxSummary | null> {
    const res = await this.db.query<{ status: string; amount: string; pay_to: string; created_at: Date }>(
      "select status, amount, pay_to, created_at from local_ledger where digest = $1",
      [digest],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      digest,
      status: row.status === "success" ? "success" : "failure",
      error: row.status === "success" ? null : "simulated failure",
      sender: "agent",
      timestampMs: row.created_at.getTime(),
      checkpoint: null,
      balanceChanges: [{ owner: row.pay_to, coinType: "USDC", amount: BigInt(row.amount) }],
    };
  }

  async getBalance(): Promise<bigint> {
    return 0n;
  }
}

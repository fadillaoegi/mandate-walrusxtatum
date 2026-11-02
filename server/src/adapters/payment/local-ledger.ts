import type { Db } from "../persistence/db.js";
import type { ChainReader, SuiTxSummary } from "../../ports/chain-reader.js";

/**
 * A clearly labelled local stand-in for the Sui ledger (dev only, no funds).
 * x402 settlements land here until settling on Sui Testnet is approved.
 */
export interface LedgerEntry {
  digest: string;
  status: "success" | "failure";
  amount: bigint;
  payTo: string;
  payer: string | null;
  createdAt: Date;
}

export interface LocalLedger {
  get(digest: string): Promise<LedgerEntry | null>;
  record(entry: Omit<LedgerEntry, "createdAt">): Promise<void>;
}

export class PgLocalLedger implements LocalLedger {
  constructor(private readonly db: Db) {}

  async get(digest: string): Promise<LedgerEntry | null> {
    const res = await this.db.query<{ status: string; amount: string; pay_to: string; payer: string | null; created_at: Date }>(
      "select status, amount, pay_to, payer, created_at from local_ledger where digest = $1",
      [digest],
    );
    const r = res.rows[0];
    return r
      ? { digest, status: r.status === "success" ? "success" : "failure", amount: BigInt(r.amount), payTo: r.pay_to, payer: r.payer, createdAt: r.created_at }
      : null;
  }

  async record(e: Omit<LedgerEntry, "createdAt">): Promise<void> {
    await this.db.query("insert into local_ledger (digest, status, amount, pay_to, payer) values ($1, $2, $3, $4, $5)", [
      e.digest,
      e.status,
      e.amount.toString(),
      e.payTo,
      e.payer,
    ]);
  }
}

/** Reads the local ledger the same way the Tatum reader reads Sui. */
export class LedgerChainReader implements ChainReader {
  constructor(
    private readonly ledger: LocalLedger,
    readonly source = "Local ledger (dev only, not Sui)",
  ) {}

  async getTransaction(digest: string): Promise<SuiTxSummary | null> {
    const e = await this.ledger.get(digest);
    if (!e) return null;
    return {
      digest,
      status: e.status,
      error: e.status === "success" ? null : "failed on the local ledger (demo control)",
      sender: e.payer,
      timestampMs: e.createdAt.getTime(),
      checkpoint: null,
      balanceChanges: [{ owner: e.payTo, coinType: "USDC", amount: e.amount }],
    };
  }

  async getBalance(): Promise<bigint> {
    return 0n;
  }
}

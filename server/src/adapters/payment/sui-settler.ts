import type { ClientWithCoreApi } from "@mysten/sui/client";
import { USDC_TESTNET, settleX402Payment, type DigestStore, type X402PaymentPayload } from "@t2000/sui-x402";
import type { Db } from "../persistence/db.js";
import type { FailNextControl } from "../../ports/payment-rail.js";
import type { MerchantSettler, SettleExpectation } from "../merchant/demo-merchant.js";

/** Replay protection that survives restarts: a settled digest is never accepted twice. */
export class PgDigestStore implements DigestStore {
  constructor(private readonly db: Db) {}
  async has(digest: string) {
    const r = await this.db.query("select 1 from x402_digests where digest = $1", [digest]);
    return (r.rowCount ?? 0) > 0;
  }
  async set(digest: string) {
    await this.db.query("insert into x402_digests (digest) values ($1) on conflict do nothing", [digest]);
  }
}

const EPOCH_CACHE_MS = 10 * 60_000;

/**
 * Merchant-side settlement on Sui TESTNET (test USDC, no real value). The merchant
 * submits the agent's signed gasless transfer and checks the balance change.
 * Chain id and epoch are cached so a 402 costs no RPC call most of the time.
 */
export class SuiSettler implements MerchantSettler, FailNextControl {
  readonly network = "testnet" as const;
  readonly currency = USDC_TESTNET;
  /** A real chain cannot be told to fail a valid transaction. */
  readonly failNextSupported = false;
  private chain: string | null = null;
  private epoch: { value: string; at: number } | null = null;

  constructor(
    private readonly client: ClientWithCoreApi,
    private readonly store: DigestStore,
    readonly label: string,
  ) {}

  setFailNext() {}
  willFailNext() {
    return false;
  }

  async context() {
    this.chain ??= (await this.client.core.getChainIdentifier()).chainIdentifier;
    if (!this.epoch || Date.now() - this.epoch.at > EPOCH_CACHE_MS) {
      this.epoch = { value: (await this.client.core.getCurrentSystemState()).systemState.epoch, at: Date.now() };
    }
    return { chain: this.chain, epoch: this.epoch.value };
  }

  async settle(payment: X402PaymentPayload, expected: SettleExpectation): Promise<{ digest: string }> {
    if (expected.network !== "testnet") throw new Error("This settler only settles on Sui Testnet");
    const r = await settleX402Payment({ payment, client: this.client, store: this.store, expected: { ...expected, network: "testnet" } });
    return { digest: r.transaction };
  }
}

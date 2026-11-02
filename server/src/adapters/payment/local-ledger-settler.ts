import { TransactionDataBuilder } from "@mysten/sui/transactions";
import { USDC_TESTNET, parseAmountToRaw, verifyX402Payment, type X402PaymentPayload } from "@t2000/sui-x402";
import type { FailNextControl } from "../../ports/payment-rail.js";
import type { MerchantSettler, SettleExpectation } from "../merchant/demo-merchant.js";
import type { LocalLedger } from "./local-ledger.js";

/** Placeholder chain id for the local ledger: base58 of 32 zero bytes. */
const LOCAL_CHAIN = "11111111111111111111111111111111";

/**
 * Merchant-side settlement onto the local ledger. Runs the real x402 checks
 * (signature binding, recipient, gasless, challenge nonce) and computes the real
 * Sui digest of the signed bytes; only the "submit to Sui" step is replaced.
 */
export class LocalLedgerSettler implements MerchantSettler, FailNextControl {
  readonly network = "localnet" as const;
  readonly currency = USDC_TESTNET;
  readonly label = "local ledger (dev only, no funds move)";
  readonly failNextSupported = true;
  private failNext = false;

  constructor(private readonly ledger: LocalLedger) {}

  setFailNext(value: boolean) {
    this.failNext = value;
  }

  willFailNext() {
    return this.failNext;
  }

  async context() {
    return { chain: LOCAL_CHAIN, epoch: "0" };
  }

  async settle(payment: X402PaymentPayload, expected: SettleExpectation): Promise<{ digest: string }> {
    const { txBytes } = verifyX402Payment({ payment, expected });
    const digest = TransactionDataBuilder.getDigestFromBytes(txBytes);
    if (await this.ledger.get(digest)) throw new Error(`Digest already used: ${digest}`);
    // Demo control: the merchant still answers "paid", but the ledger records a failed tx.
    const status = this.failNext ? "failure" : "success";
    this.failNext = false;
    await this.ledger.record({
      digest,
      status,
      amount: parseAmountToRaw(expected.amount, expected.currency.decimals),
      payTo: expected.recipient,
      payer: payment.payload.senderAddress,
    });
    return { digest };
  }
}

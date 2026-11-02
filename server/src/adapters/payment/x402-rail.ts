import { normalizeSuiAddress, fromBase64 } from "@mysten/sui/utils";
import { TransactionDataBuilder } from "@mysten/sui/transactions";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import type { Signer } from "@mysten/sui/cryptography";
import {
  X402_PAYMENT_HEADER,
  X402_PAYMENT_RESPONSE_HEADER,
  buildX402SignedPayment,
  x402Network,
  type X402Requirements,
} from "@t2000/sui-x402";
import { formatUsd } from "../../domain/model.js";
import { PaymentRefusedError, type PaymentProof, type PaymentRail, type PaymentRequirement } from "../../ports/payment-rail.js";
import type { X402Net } from "../merchant/demo-merchant.js";

/**
 * Rail A: x402 "exact" on Sui (via @t2000/sui-x402). The agent asks the merchant,
 * gets HTTP 402, checks the terms against what Mandate approved, signs a gasless
 * USDC transfer and lets the merchant settle it. It never signs for more than
 * the approved amount or for anyone but the vendor's known address.
 */
export class X402Rail implements PaymentRail {
  readonly id = "A" as const;

  constructor(
    private readonly o: {
      merchantBaseUrl: string;
      network: X402Net;
      label: string;
      signerFor: (agentId: string) => Signer;
      payToOf: (vendor: string) => string;
      client?: ClientWithCoreApi;
      fetch?: typeof fetch;
    },
  ) {}

  get label() {
    return this.o.label;
  }

  async pay(req: PaymentRequirement): Promise<PaymentProof> {
    const f = this.o.fetch ?? fetch;
    const url = `${this.o.merchantBaseUrl}/merchant/items/${encodeURIComponent(req.resource)}`;

    const offer = await f(url);
    if (offer.status !== 402) throw new PaymentRefusedError(`Merchant answered HTTP ${offer.status} instead of 402`);
    const terms = ((await offer.json()) as { accepts?: X402Requirements[] }).accepts?.[0];
    if (!terms || terms.scheme !== "exact") throw new PaymentRefusedError("Merchant offered no x402 'exact' terms");

    // The agent's own guardrails, independent of the merchant.
    if (terms.network !== x402Network(this.o.network)) {
      throw new PaymentRefusedError(`Merchant wants ${terms.network}, agent pays on ${x402Network(this.o.network)}`);
    }
    const asked = BigInt(terms.maxAmountRequired);
    if (asked !== BigInt(req.amount)) {
      throw new PaymentRefusedError(
        `Merchant asked ${formatUsd(Number(asked))} but Mandate approved ${formatUsd(req.amount)}; agent refused to sign`,
      );
    }
    if (normalizeSuiAddress(terms.payTo) !== normalizeSuiAddress(this.o.payToOf(req.vendor))) {
      throw new PaymentRefusedError(`Merchant asked to pay an unknown address for ${req.vendor}; agent refused to sign`);
    }

    const signer = this.o.signerFor(req.payer);
    const { header, payment } = await buildX402SignedPayment({ requirements: terms, signer, client: this.o.client });
    // This digest identifies exactly what the agent signed. Even if the merchant settles and
    // its HTTP response is lost, the app can check this digest instead of charging again.
    const digest = TransactionDataBuilder.getDigestFromBytes(fromBase64(payment.payload.txBytes));
    const proof: PaymentProof = { rail: "A", network: terms.network, digest, payer: signer.toSuiAddress() };
    let paid: Response;
    try {
      paid = await f(url, { headers: { [X402_PAYMENT_HEADER]: header } });
    } catch {
      return proof; // submission is uncertain; the chain reader must decide
    }
    if (!paid.ok) return proof; // a response can fail after the merchant has settled
    const raw = paid.headers.get(X402_PAYMENT_RESPONSE_HEADER);
    if (!raw) return proof;
    try {
      const receipt = JSON.parse(new TextDecoder().decode(fromBase64(raw))) as { transaction?: string };
      // The merchant's digest is a claim. A different digest cannot replace the signed one.
      if (receipt.transaction !== digest) return proof;
    } catch {
      return proof;
    }
    return proof;
  }
}

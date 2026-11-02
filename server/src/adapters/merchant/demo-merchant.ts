import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  X402_PAYMENT_HEADER,
  X402_PAYMENT_RESPONSE_HEADER,
  X402_VERSION,
  createX402Requirements,
  encodeX402Response,
  parseX402Header,
  x402Network,
  type X402PaymentPayload,
} from "@t2000/sui-x402";
import type { Catalog } from "../../ports/catalog.js";

export type X402Net = "localnet" | "testnet" | "mainnet";

export interface SettleExpectation {
  challengeId: string;
  amount: string;
  currency: { type: string; decimals: number };
  recipient: string;
  network: X402Net;
}

/** How the merchant turns a signed payment into a settled transaction. */
export interface MerchantSettler {
  readonly network: X402Net;
  readonly currency: { type: string; decimals: number };
  readonly label: string;
  context(): Promise<{ chain: string; epoch: string }>;
  settle(payment: X402PaymentPayload, expected: SettleExpectation): Promise<{ digest: string }>;
}

/** micro-USD == USDC raw units (6 decimals). */
const toAmount = (micro: number) => (micro / 1_000_000).toFixed(6);

const CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * DEMO MERCHANT (our own, clearly labelled). Sells the demo catalog over x402:
 * no payment → HTTP 402 with requirements; X-PAYMENT → verify, settle, deliver.
 * `priceOf` lets tests (and a demo control) make the merchant overcharge.
 */
export function createDemoMerchant(opts: {
  catalog: Catalog;
  settler: MerchantSettler;
  priceOf?: (itemId: string, listed: number) => number;
}): Router {
  const { catalog, settler } = opts;
  const challenges = new Map<string, { itemId: string; amount: string; recipient: string; expires: number }>();
  const router = Router();

  router.get("/items/:itemId", async (req, res, next) => {
    try {
      const item = catalog.item(String(req.params.itemId));
      if (!item) return void res.status(404).json({ error: "Unknown item" });
      const header = req.header(X402_PAYMENT_HEADER);

      if (!header) {
        const price = opts.priceOf ? opts.priceOf(item.itemId, item.price) : item.price;
        const challengeId = randomUUID();
        const recipient = catalog.vendorAddress(item.vendor);
        const { chain, epoch } = await settler.context();
        const accepts = createX402Requirements({
          challengeId,
          amount: toAmount(price),
          currency: settler.currency,
          recipient,
          resource: req.originalUrl,
          network: settler.network,
          chain,
          currentEpoch: epoch,
        });
        challenges.set(challengeId, { itemId: item.itemId, amount: toAmount(price), recipient, expires: Date.now() + CHALLENGE_TTL_MS });
        return void res.status(402).json({ x402Version: X402_VERSION, error: "X-PAYMENT header is required", accepts: [accepts] });
      }

      let payment: X402PaymentPayload;
      try {
        payment = parseX402Header(header);
      } catch (err) {
        return void res.status(402).json({ x402Version: X402_VERSION, error: (err as Error).message });
      }
      const ch = challenges.get(payment.payload.challengeId);
      if (!ch || ch.itemId !== item.itemId || ch.expires < Date.now()) {
        return void res.status(402).json({ x402Version: X402_VERSION, error: "Unknown, used or expired challenge" });
      }
      challenges.delete(payment.payload.challengeId); // one challenge, one payment (no replay)

      let digest: string;
      try {
        ({ digest } = await settler.settle(payment, {
          challengeId: payment.payload.challengeId,
          amount: ch.amount,
          currency: settler.currency,
          recipient: ch.recipient,
          network: settler.network,
        }));
      } catch (err) {
        return void res.status(402).json({ x402Version: X402_VERSION, error: (err as Error).message });
      }

      res.setHeader(
        X402_PAYMENT_RESPONSE_HEADER,
        encodeX402Response({ success: true, network: x402Network(settler.network), transaction: digest, payer: payment.payload.senderAddress }),
      );
      res.json({ itemId: item.itemId, title: item.title, vendor: item.vendor, data: `Demo dataset: ${item.title}` });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { X402_PAYMENT_HEADER } from "@t2000/sui-x402";
import { TransactionDataBuilder } from "@mysten/sui/transactions";
import { DemoCatalog } from "../src/adapters/demo/demo-catalog.js";
import { createDemoMerchant } from "../src/adapters/merchant/demo-merchant.js";
import { LedgerChainReader, type LedgerEntry, type LocalLedger } from "../src/adapters/payment/local-ledger.js";
import { LocalLedgerSettler } from "../src/adapters/payment/local-ledger-settler.js";
import { X402Rail } from "../src/adapters/payment/x402-rail.js";
import { devAgentSigner } from "../src/adapters/payment/dev-wallets.js";
import { PaymentRefusedError } from "../src/ports/payment-rail.js";
import { usd } from "../src/domain/model.js";
import { appFetch } from "./helpers/app-fetch.js";

class MemoryLedger implements LocalLedger {
  entries = new Map<string, LedgerEntry>();
  async get(digest: string) {
    return this.entries.get(digest) ?? null;
  }
  async record(e: Omit<LedgerEntry, "createdAt">) {
    this.entries.set(e.digest, { ...e, createdAt: new Date() });
  }
}

const catalog = new DemoCatalog();
const ledger = new MemoryLedger();
const settler = new LocalLedgerSettler(ledger);
let overcharge = 0;
let merchant: Awaited<ReturnType<typeof appFetch>>;

beforeAll(async () => {
  const app = express();
  app.use("/merchant", createDemoMerchant({ catalog, settler, priceOf: (_id, listed) => listed + overcharge }));
  merchant = await appFetch(app);
});
afterAll(() => merchant?.close());

function rail(opts: { fetch?: typeof fetch; payToOf?: (v: string) => string } = {}) {
  return new X402Rail({
    merchantBaseUrl: merchant.base,
    network: "localnet",
    label: "test",
    signerFor: devAgentSigner,
    payToOf: opts.payToOf ?? ((v) => catalog.vendorAddress(v)),
    fetch: opts.fetch ?? merchant.fetch,
  });
}

const buy = { payer: "research-agent", vendor: "OpenStats", resource: "os-rainfall-yield", amount: usd(0.25) };

describe("x402 rail against the demo merchant", () => {
  it("gets a 402, signs, and the merchant settles a real Sui digest on the ledger", async () => {
    const proof = await rail().pay(buy);
    expect(proof).toMatchObject({ rail: "A", network: "sui:localnet", payer: devAgentSigner("research-agent").toSuiAddress() });
    expect(proof.digest).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/); // base58 Sui digest
    const entry = await ledger.get(proof.digest!);
    expect(entry).toMatchObject({ status: "success", amount: 250_000n, payTo: catalog.vendorAddress("OpenStats") });
    expect((await new LedgerChainReader(ledger).getTransaction(proof.digest!))?.status).toBe("success");
  });

  it("refuses to sign when the merchant asks more than Mandate approved", async () => {
    overcharge = usd(0.1);
    const before = ledger.entries.size;
    try {
      await expect(rail().pay(buy)).rejects.toThrow("Merchant asked $0.35 but Mandate approved $0.25");
      await expect(rail().pay(buy)).rejects.toBeInstanceOf(PaymentRefusedError);
    } finally {
      overcharge = 0;
    }
    expect(ledger.entries.size).toBe(before);
  });

  it("refuses to pay an address that is not the vendor's", async () => {
    const other = catalog.vendorAddress("ShadyData");
    await expect(rail({ payToOf: () => other }).pay(buy)).rejects.toThrow("unknown address");
  });

  it("a signed payment cannot be replayed", async () => {
    let captured: { url: string; header: string } | null = null;
    const spy: typeof fetch = async (input, init) => {
      const h = (init?.headers as Record<string, string> | undefined)?.[X402_PAYMENT_HEADER];
      if (h) captured = { url: String(input), header: h };
      return merchant.fetch(input, init);
    };
    await rail({ fetch: spy }).pay(buy);
    const again = await merchant.fetch(captured!.url, { headers: { [X402_PAYMENT_HEADER]: captured!.header } });
    expect(again.status).toBe(402);
    expect(((await again.json()) as { error: string }).error).toMatch(/used or expired/);
  });

  it("preserves the signed digest if the merchant settles but its HTTP reply is lost", async () => {
    const before = ledger.entries.size;
    const lostReply: typeof fetch = async (input, init) => {
      const response = await merchant.fetch(input, init);
      if ((init?.headers as Record<string, string> | undefined)?.[X402_PAYMENT_HEADER]) {
        expect(response.ok).toBe(true); // settlement happened; only the reply was lost
        throw new Error("connection closed after settlement");
      }
      return response;
    };
    const proof = await rail({ fetch: lostReply }).pay(buy);
    expect(proof.digest).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(ledger.entries.size).toBe(before + 1);
    expect((await new LedgerChainReader(ledger).getTransaction(proof.digest!))?.status).toBe("success");
  });

  it("demo control: the merchant says paid, but the ledger records a failed tx", async () => {
    settler.setFailNext(true);
    const proof = await rail().pay(buy);
    expect(settler.willFailNext()).toBe(false);
    expect((await new LedgerChainReader(ledger).getTransaction(proof.digest!))?.status).toBe("failure");
  });
});

describe("Sui Testnet settler (fake chain client, no network)", () => {
  it("settles through the client, checks the balance change and returns the signed digest", async () => {
    const { SuiSettler } = await import("../src/adapters/payment/sui-settler.js");
    const { USDC_TESTNET } = await import("@t2000/sui-x402");
    const payTo = catalog.vendorAddress("OpenStats");
    let calls = 0;
    const fakeClient = {
      core: {
        getChainIdentifier: async () => ({ chainIdentifier: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD" }),
        getCurrentSystemState: async () => ({ systemState: { epoch: "1271" } }),
        executeTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
          calls++;
          return {
            $kind: "Transaction",
            Transaction: {
              digest: TransactionDataBuilder.getDigestFromBytes(transaction),
              status: { success: true, error: null },
              balanceChanges: [{ coinType: USDC_TESTNET.type, address: payTo, amount: "250000" }],
            },
          };
        },
      },
    };
    const seen = new Set<string>();
    const store = { has: async (d: string) => seen.has(d), set: async (d: string) => void seen.add(d) };
    const sui = new SuiSettler(fakeClient as never, store, "fake testnet");
    const app = express();
    app.use("/merchant", createDemoMerchant({ catalog, settler: sui }));
    const testnetMerchant = await appFetch(app);
    try {
      const testnetRail = new X402Rail({ merchantBaseUrl: testnetMerchant.base, fetch: testnetMerchant.fetch, network: "testnet", label: "t", signerFor: devAgentSigner, payToOf: (v) => catalog.vendorAddress(v) });
      const proof = await testnetRail.pay(buy);
      expect(proof).toMatchObject({ network: "sui:testnet", digest: expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/) });
      expect(seen.has(proof.digest!)).toBe(true);
      expect(calls).toBe(1);
      expect(sui.willFailNext()).toBe(false);
    } finally {
      await testnetMerchant.close();
    }
  });
});

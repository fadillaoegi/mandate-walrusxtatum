/**
 * ONE real x402 payment on Sui TESTNET (test USDC, no real value), end to end:
 * demo merchant (HTTP 402) → agent signs → merchant settles via Tatum → Mandate re-reads the tx via Tatum.
 * Uses the same adapters as the app. About 4–7 Tatum requests.
 *   npm run spike:x402-testnet -w server
 */
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import express from "express";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { DemoCatalog } from "../adapters/demo/demo-catalog.js";
import { createDemoMerchant } from "../adapters/merchant/demo-merchant.js";
import { SuiSettler } from "../adapters/payment/sui-settler.js";
import { X402Rail } from "../adapters/payment/x402-rail.js";
import { TatumSuiGrpcReader } from "../adapters/chain/tatum-sui-grpc-reader.js";
import { loadConfig, requireKeys, testnetTatumConfig } from "../infrastructure/config.js";
import { usd } from "../domain/model.js";

const cfg = loadConfig();
requireKeys(cfg, ["AGENT_WALLET_PRIVATE_KEY"]);
const tatum = new TatumSuiGrpcReader(testnetTatumConfig(cfg));
const catalog = new DemoCatalog();
const seen = new Set<string>();
const settler = new SuiSettler(tatum.client, { has: async (d) => seen.has(d), set: async (d) => void seen.add(d) }, "Sui Testnet via Tatum");
const wallet = Ed25519Keypair.fromSecretKey(cfg.AGENT_WALLET_PRIVATE_KEY);

const app = express();
app.use("/merchant", createDemoMerchant({ catalog, settler }));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
let settledDigest: string | null = null;

try {
  const rail = new X402Rail({ merchantBaseUrl: base, network: "testnet", label: "spike", signerFor: () => wallet, payToOf: (v) => catalog.vendorAddress(v) });
  const item = catalog.item("qf-farmgate")!; // $0.08
  console.log(`agent ${wallet.toSuiAddress().slice(0, 10)}… buys "${item.title}" for $0.08 from demo vendor ${item.vendor}`);
  const t0 = Date.now();
  const proof = await rail.pay({ payer: "research-agent", vendor: item.vendor, resource: item.itemId, amount: usd(0.08) });
  settledDigest = proof.digest;
  console.log(`settled in ${Date.now() - t0} ms · ${proof.network} · digest ${proof.digest}`);
  let tx = null;
  let lastReadError: unknown = null;
  for (let i = 0; i < 4 && !tx; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1000));
    try {
      tx = await tatum.getTransaction(proof.digest!);
    } catch (err) {
      lastReadError = err;
    }
  }
  if (!tx && lastReadError) throw lastReadError;
  console.log(`Tatum re-read: ${tx ? tx.status : "not found yet"} · checkpoint ${tx?.checkpoint ?? "-"}`);
  console.log(`explorer: https://suiscan.xyz/testnet/tx/${proof.digest}`);
  if (tx?.status !== "success") process.exitCode = 1;
} catch (err) {
  process.exitCode = 1;
  if (settledDigest) {
    console.log(`Payment submitted: ${settledDigest}; independent verification is unavailable.`);
    console.log(`Do not pay again. Re-read it with: npm run spike:tatum-testnet -w server -- ${settledDigest}`);
  } else {
    console.log("payment failed:", (err as Error).message);
  }
} finally {
  server.close();
}

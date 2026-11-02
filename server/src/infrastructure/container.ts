import { MandateApp } from "../application/mandate-app.js";
import { DemoCatalog } from "../adapters/demo/demo-catalog.js";
import { LocalMemoryStore } from "../adapters/memory/local-memory-store.js";
import { SimulatedRail } from "../adapters/payment/simulated-rail.js";
import { LedgerChainReader, PgLocalLedger } from "../adapters/payment/local-ledger.js";
import { LocalLedgerSettler } from "../adapters/payment/local-ledger-settler.js";
import { X402Rail } from "../adapters/payment/x402-rail.js";
import { devAgentSigner } from "../adapters/payment/dev-wallets.js";
import { createDemoMerchant, type MerchantSettler } from "../adapters/merchant/demo-merchant.js";
import { PgDigestStore, SuiSettler } from "../adapters/payment/sui-settler.js";
import { TatumSuiGrpcReader } from "../adapters/chain/tatum-sui-grpc-reader.js";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import type { Signer } from "@mysten/sui/cryptography";
import { PgAppRepository } from "../adapters/persistence/pg-app-repository.js";
import { createDb, migrate } from "../adapters/persistence/db.js";
import { LocalDelegateAccess } from "../adapters/memory/local-delegate-access.js";
import type { MemoryStore } from "../ports/memory-store.js";
import type { ChainReader } from "../ports/chain-reader.js";
import type { FailNextControl, PaymentRail } from "../ports/payment-rail.js";
import { type Config, requireKeys, testnetTatumConfig } from "./config.js";
import { makeWalrus } from "./factories.js";

export interface Modes {
  memory: "walrus" | "local";
  chain: "tatum" | "local-ledger";
  rail: "A" | "D";
}

/** Composition root: the only place that picks concrete adapters. */
export async function buildContainer(cfg: Config) {
  const db = createDb(cfg.DATABASE_URL);
  await migrate(db);

  const useWalrus = cfg.MEMORY_MODE === "walrus";
  const memory: MemoryStore = useWalrus ? makeWalrus(cfg) : new LocalMemoryStore(db, cfg.MEMWAL_NAMESPACE);
  const catalog = new DemoCatalog();

  // Payments: x402 over HTTP against our labelled demo merchant. The settler decides where
  // the money moves: a local ledger (dev only) or Sui Testnet through Tatum (test USDC).
  const testnet = cfg.PAYMENT_RAIL === "x402-testnet";
  let chain: ChainReader;
  let settler: MerchantSettler & FailNextControl;
  let signerFor: (agentId: string) => Signer = devAgentSigner;
  if (testnet) {
    requireKeys(cfg, ["AGENT_WALLET_PRIVATE_KEY"]);
    const tatum = new TatumSuiGrpcReader(testnetTatumConfig(cfg));
    chain = tatum;
    settler = new SuiSettler(tatum.client, new PgDigestStore(db), "Sui Testnet via Tatum (test USDC)");
    const wallet = Ed25519Keypair.fromSecretKey(cfg.AGENT_WALLET_PRIVATE_KEY);
    signerFor = () => wallet; // one testnet wallet shared by the demo agents
  } else {
    const ledger = new PgLocalLedger(db);
    chain = new LedgerChainReader(ledger);
    settler = new LocalLedgerSettler(ledger);
  }

  // Demo control "greedy merchant": the next 402 asks $0.10 more than the listed price.
  const merchantControl = { overchargeNext: false };
  const merchant = createDemoMerchant({
    catalog,
    settler,
    priceOf: (_itemId, listed) => {
      if (!merchantControl.overchargeNext) return listed;
      merchantControl.overchargeNext = false;
      return listed + 100_000;
    },
  });

  let rail: PaymentRail;
  let demoControl: FailNextControl;
  if (cfg.PAYMENT_RAIL === "simulated") {
    const simulated = new SimulatedRail(db);
    rail = simulated;
    demoControl = simulated;
  } else {
    rail = new X402Rail({
      merchantBaseUrl: `http://127.0.0.1:${cfg.API_PORT}`,
      network: settler.network,
      label: `x402 on Sui · settled on ${settler.label}`,
      signerFor,
      payToOf: (vendor) => catalog.vendorAddress(vendor),
      // No client: the agent signs offline with the chain id + epoch from the 402 (saves Tatum calls).
    });
    demoControl = settler;
  }

  const repo = new PgAppRepository(db);
  // Revoking a Walrus delegate key is an owner action in the Memory dashboard; the app
  // detects it from the relayer's 401 and also enforces an in-app cut-off.
  const delegateId = useWalrus && cfg.MEMWAL_PUBLIC_KEY ? `walrus:${cfg.MEMWAL_PUBLIC_KEY.slice(0, 10)}…` : "local-delegate-dev";
  const access = new LocalDelegateAccess(db, delegateId, memory.verifyAccess ? () => memory.verifyAccess!() : undefined);
  const app = new MandateApp({
    memory, chain, rail, repo, catalog, access,
    namespaceBase: cfg.MEMWAL_NAMESPACE,
    writeConcurrency: useWalrus ? 3 : 8,
    verifyRetries: testnet ? 3 : 0,
  });
  await app.init();
  const modes: Modes = { memory: useWalrus ? "walrus" : "local", chain: testnet ? "tatum" : "local-ledger", rail: rail.id === "A" ? "A" : "D" };

  return { db, app, repo, catalog, memory, chain, rail, demoControl, merchant, merchantControl, access, modes };
}

export type Container = Awaited<ReturnType<typeof buildContainer>>;

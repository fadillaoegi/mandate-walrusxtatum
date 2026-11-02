/**
 * Agent wallet on Sui TESTNET (test tokens only, no real value).
 *
 *   npm run wallet:testnet -w server -- init      create the key in ../.env (offline; prints the address only)
 *   npm run wallet:testnet -w server -- status    SUI + USDC balances (coin objects vs address balance)
 *   npm run wallet:testnet -w server -- fund-sui  ask the public Sui testnet faucet for gas SUI
 *   npm run wallet:testnet -w server -- preview-deposit  simulate coin-object deposit, no signature or transfer
 *   npm run wallet:testnet -w server -- deposit   move USDC coin objects into the address balance (x402 pays from there)
 *   npm run wallet:testnet -w server -- verify-deposit <digest>  wait for indexing and re-read balances (no transaction)
 *
 * Uses the free public Sui testnet fullnode, so no Tatum quota is spent here.
 */
import { appendFileSync, chmodSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import { getFaucetHost, requestSuiFromFaucetV3 } from "@mysten/sui/faucet";
import { USDC_TESTNET } from "@t2000/sui-x402";
import { publicTestnetBalances } from "./public-balance.js";

const ENV = new URL("../../../.env", import.meta.url).pathname;
const cmd = process.argv[2] ?? "status";

function loadKey(): string {
  // Match Node's .env semantics: the last assignment wins, including after init appends
  // a generated key to the empty placeholder copied from .env.example.
  return parseEnv(readFileSync(ENV, "utf8")).AGENT_WALLET_PRIVATE_KEY ?? "";
}

if (cmd === "init") {
  let key = loadKey();
  if (!key) {
    key = Ed25519Keypair.generate().getSecretKey(); // suiprivkey1… (bech32)
    appendFileSync(ENV, `\n# Agent wallet on Sui TESTNET (test tokens only). Never reuse on mainnet.\nAGENT_WALLET_PRIVATE_KEY=${key}\n`);
    chmodSync(ENV, 0o600);
    console.log("New testnet agent wallet saved to .env (key not shown).");
  } else {
    console.log("Testnet agent wallet already in .env.");
  }
  console.log("address:", Ed25519Keypair.fromSecretKey(key).toSuiAddress());
  process.exit(0);
}

const key = loadKey();
if (!key) throw new Error("No AGENT_WALLET_PRIVATE_KEY in .env; run `init` first.");
const signer = Ed25519Keypair.fromSecretKey(key);
const owner = signer.toSuiAddress();
const client = new SuiGrpcClient({ baseUrl: "https://fullnode.testnet.sui.io:443", network: "testnet" });
const graphqlClient = new SuiGraphQLClient({ url: "https://graphql.testnet.sui.io/graphql", network: "testnet" });

async function status() {
  // Public GraphQL reads both balances in one call. Some networks/proxies reject the
  // SDK's gRPC-web fetch, so keep the gRPC path as a fallback.
  let sui: { balance: string; coinBalance: string; addressBalance: string };
  let usdc: { balance: string; coinBalance: string; addressBalance: string };
  try {
    ({ sui, usdc } = await publicTestnetBalances(owner, USDC_TESTNET.type));
  } catch (graphqlError) {
    try {
      const [suiResult, usdcResult] = await Promise.all([
        client.core.getBalance({ owner, coinType: "0x2::sui::SUI" }),
        client.core.getBalance({ owner, coinType: USDC_TESTNET.type }),
      ]);
      sui = suiResult.balance;
      usdc = usdcResult.balance;
    } catch {
      throw new Error(`Public Sui Testnet balance reads failed via GraphQL and gRPC. GraphQL: ${graphqlError instanceof Error ? graphqlError.message : String(graphqlError)}`);
    }
  }
  const fmt = (raw: string, d: number) => (Number(raw) / 10 ** d).toFixed(d === 9 ? 4 : 2);
  console.log("address:", owner);
  console.log(`SUI : ${fmt(sui.balance, 9)}`);
  console.log(`USDC: ${fmt(usdc.balance, 6)} total = ${fmt(usdc.coinBalance, 6)} in coin objects + ${fmt(usdc.addressBalance, 6)} in address balance`);
}

if (cmd === "status") await status();

if (cmd === "fund-sui") {
  // V3 solves a small proof-of-work instead of a captcha (may take up to ~1 min).
  await requestSuiFromFaucetV3({ host: getFaucetHost("testnet"), recipient: owner });
  console.log("Faucet request sent; balances may take a few seconds.");
}

if (cmd === "verify-deposit") {
  const digest = process.argv[3];
  if (!digest) throw new Error("Usage: wallet:testnet -- verify-deposit <existing digest>");
  await graphqlClient.waitForTransaction({ digest, timeout: 30_000 });
  console.log("deposit indexed:", digest);
  await status();
}

if (cmd === "preview-deposit" || cmd === "deposit") {
  const coins = await graphqlClient.core.listCoins({ owner, coinType: USDC_TESTNET.type });
  if (coins.hasNextPage) throw new Error("More than one page of USDC coin objects; refusing a partial deposit");
  if (coins.objects.length === 0) {
    console.log("No USDC coin objects to deposit.");
  } else {
    const tx = new Transaction();
    tx.setSender(owner);
    const [first, ...rest] = coins.objects.map((c) => tx.objectRef({ objectId: c.objectId, version: c.version, digest: c.digest }));
    if (rest.length) tx.mergeCoins(first!, rest);
    tx.moveCall({ target: "0x2::coin::send_funds", typeArguments: [USDC_TESTNET.type], arguments: [first!, tx.pure.address(owner)] });
    const total = coins.objects.reduce((sum, c) => sum + BigInt(c.balance), 0n);
    console.log(`Coin objects: ${coins.objects.length}; moving ${(Number(total) / 1_000_000).toFixed(2)} testnet USDC to the SAME address: ${owner}`);
    if (cmd === "preview-deposit") {
      const simulation = await graphqlClient.simulateTransaction({ transaction: tx, include: { effects: true }, doGasSelection: true });
      const simulated = simulation.Transaction ?? simulation.FailedTransaction;
      console.log("simulation:", simulated?.status.success ? "success" : `failed: ${simulated?.status.error?.message}`);
      if (!simulated?.status.success) process.exitCode = 1;
    } else {
      const res = await graphqlClient.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true } });
      const done = res.Transaction ?? res.FailedTransaction;
      console.log("deposit tx:", done?.digest, done?.status.success ? "success" : `failed: ${done?.status.error?.message}`);
      if (!done?.status.success) process.exitCode = 1;
      if (done?.status.success && done.digest) {
        try {
          await graphqlClient.waitForTransaction({ digest: done.digest, timeout: 30_000 });
          console.log("deposit indexed:", done.digest);
          await status();
        } catch {
          console.log(`Execution succeeded but the index has not caught up. Recheck without paying again: npm run wallet:testnet -w server -- verify-deposit ${done.digest}`);
        }
      }
    }
  }
}

/**
 * Spike (rail A): x402 "exact" on Sui via @t2000/sui-x402 — no funds, no network writes.
 *
 * 1. Merchant builds 402 requirements (testnet USDC).
 * 2. Agent builds + signs a gasless USDC transfer with a throwaway keypair (never funded).
 * 3. Merchant parses the X-PAYMENT header and verifies it offline.
 * 4. Tampered payments must be rejected.
 * 5. Optional, read-only: fetch testnet epoch/chain id and simulate (no execution).
 *
 * Run: npm run spike:x402 -w server [-- --network [--mainnet]]   (reads + simulate only)
 */
import { randomUUID } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  USDC,
  USDC_TESTNET,
  buildX402SignedPayment,
  createX402Requirements,
  parseX402Header,
  verifyX402Payment,
  type X402PaymentPayload,
} from "@t2000/sui-x402";

const useNetwork = process.argv.includes("--network");
const net = process.argv.includes("--mainnet") ? ("mainnet" as const) : ("testnet" as const);
const currency = net === "mainnet" ? USDC : USDC_TESTNET;
const merchant = Ed25519Keypair.generate().toSuiAddress();
const agent = Ed25519Keypair.generate(); // throwaway, holds nothing
const challengeId = randomUUID();
const expected = { challengeId, amount: "0.20", currency, recipient: merchant, network: net };

let client: SuiGrpcClient | undefined;
let chain = "11111111111111111111111111111111"; // base58 of 32 zero bytes (offline placeholder)
let currentEpoch: string | number = 0;
if (useNetwork) {
  // Public fullnodes dropped JSON-RPC; gRPC is the supported read path.
  client = new SuiGrpcClient({ baseUrl: `https://fullnode.${net}.sui.io:443`, network: net });
  chain = (await client.core.getChainIdentifier()).chainIdentifier;
  currentEpoch = (await client.core.getCurrentSystemState()).systemState.epoch;
  console.log(`${net} chain=${chain} epoch=${currentEpoch}`);
}

const requirements = createX402Requirements({
  challengeId,
  amount: expected.amount,
  currency,
  recipient: merchant,
  resource: "/demo-merchant/os-coffee-exports",
  network: net,
  chain,
  currentEpoch,
});
console.log("402 accepts[0]:", { ...requirements, payTo: `${merchant.slice(0, 10)}…` });

const { header, payment } = await buildX402SignedPayment({ requirements, signer: agent, client });
console.log(`X-PAYMENT header: ${header.length} chars, sender ${payment.payload.senderAddress.slice(0, 10)}…`);

const check = (label: string, p: X402PaymentPayload, exp = expected) => {
  try {
    verifyX402Payment({ payment: p, expected: exp });
    console.log(`  ${label}: ACCEPTED`);
  } catch (e) {
    console.log(`  ${label}: rejected — ${(e as Error).message}`);
  }
};

console.log("verify:");
check("genuine payment", parseX402Header(header));
check("other challenge", payment, { ...expected, challengeId: randomUUID() });
check("other recipient", payment, { ...expected, recipient: Ed25519Keypair.generate().toSuiAddress() });
check("other network", payment, { ...expected, network: net === "mainnet" ? "testnet" : "mainnet" });
check("forged sender", { ...payment, payload: { ...payment.payload, senderAddress: merchant } });

if (client) {
  const sim = await client.core
    .simulateTransaction({ transaction: Uint8Array.from(Buffer.from(payment.payload.txBytes, "base64")), include: { effects: true } })
    .then((r) => (r.$kind === "Transaction" ? r.Transaction.status : r.FailedTransaction.status))
    .catch((e: Error) => ({ error: e.message }));
  console.log("simulate (no execution, unfunded sender):", JSON.stringify(sim).slice(0, 400));
}

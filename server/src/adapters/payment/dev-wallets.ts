import { createHash } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

/**
 * DEV ONLY: each agent's wallet for the local ledger, derived from its id.
 * These keys are public by construction and never hold funds; Testnet/Mainnet
 * wallets come from the environment instead.
 */
export function devAgentSigner(agentId: string): Ed25519Keypair {
  const seed = createHash("sha256").update(`mandate-local-dev-wallet:${agentId}`).digest();
  return Ed25519Keypair.fromSecretKey(new Uint8Array(seed));
}

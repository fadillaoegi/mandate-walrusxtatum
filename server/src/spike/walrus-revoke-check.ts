/**
 * Live revoke test with a SECOND, throwaway delegate key (never the main one).
 * One light request per run (list one namespace). Usage:
 *   npm run spike:revoke-check -w server
 * 1) run with MEMWAL_TEST_PRIVATE_KEY registered  → expect "accepted"
 * 2) remove that key in the Walrus Memory dashboard, run again → expect "rejected (401)"
 */
import { WalrusMemoryStore } from "../adapters/memory/walrus-memory-store.js";
import { loadConfig } from "../infrastructure/config.js";

const cfg = loadConfig();
const key = process.env.MEMWAL_TEST_PRIVATE_KEY ?? "";
if (!key) throw new Error("Set MEMWAL_TEST_PRIVATE_KEY in .env (a second delegate key made for this test).");
const store = new WalrusMemoryStore({ privateKey: key, accountId: cfg.MEMWAL_ACCOUNT_ID, serverUrl: cfg.MEMWAL_SERVER_URL, namespace: "revoke-test" });
const accepted = await store.verifyAccess();
console.log(`test delegate key ${(await store.publicKeyHex()).slice(0, 10)}… → ${accepted ? "accepted by Walrus" : "rejected by Walrus (401): revoke detected"}`);

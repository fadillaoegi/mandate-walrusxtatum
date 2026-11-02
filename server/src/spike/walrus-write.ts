/** Spike 1a: write one Mandate memory to Walrus Memory Mainnet. */
import { loadConfig } from "../infrastructure/config.js";
import { makeWalrus } from "../infrastructure/factories.js";
import { usd } from "../domain/model.js";

const cfg = loadConfig();
const store = makeWalrus(cfg);
console.log("relayer:", cfg.MEMWAL_SERVER_URL, "namespace:", cfg.MEMWAL_NAMESPACE);
console.log("health:", await store.health());
console.log("delegate public key (MEMWAL_AGENT_ID):", await store.publicKeyHex());

const t0 = Date.now();
const { blobId } = await store.remember({
  kind: "mandate_set",
  at: new Date().toISOString(),
  rules: { maxPerItem: usd(0.5), maxPerDay: usd(2), blockedVendors: ["ShadyData"] },
});
console.log(`written in ${Date.now() - t0} ms, blob_id: ${blobId}`);

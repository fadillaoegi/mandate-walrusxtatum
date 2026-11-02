/** Spike 1b: run in a fresh process; rebuild knowledge from Walrus only. */
import { loadConfig } from "../infrastructure/config.js";
import { makeWalrus } from "../infrastructure/factories.js";
import { fold } from "../domain/memory-events.js";

const store = makeWalrus(loadConfig());
const t0 = Date.now();
const memories = await store.recallAll();
console.log(`recalled ${memories.length} Mandate memories in ${Date.now() - t0} ms`);
for (const m of memories) console.log(" -", m.event.kind, m.event.at, m.blobId);
console.log("knowledge:", JSON.stringify(fold(memories.map((m) => m.event)), null, 2));

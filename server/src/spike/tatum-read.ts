/** Spike 2: read a Sui Mainnet transaction through Tatum. Usage: npm run spike:tatum [digest] */
import { loadConfig } from "../infrastructure/config.js";
import { makeTatum } from "../infrastructure/factories.js";

const tatum = makeTatum(loadConfig());
const digest = process.argv[2] ?? (await tatum.latestTxDigest());
if (!digest) throw new Error("no digest found");
const t0 = Date.now();
const tx = await tatum.getTransaction(digest);
console.log(`read in ${Date.now() - t0} ms`);
console.log(JSON.stringify(tx, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

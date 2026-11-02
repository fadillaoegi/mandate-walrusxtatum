/** One request: probe the Testnet gateway, or re-read an existing payment with -- <digest>. */
import { TatumSuiGrpcReader } from "../adapters/chain/tatum-sui-grpc-reader.js";
import { loadConfig, testnetTatumConfig } from "../infrastructure/config.js";

const cfg = loadConfig();
const reader = new TatumSuiGrpcReader(testnetTatumConfig(cfg));
const t0 = Date.now();
try {
  const digest = process.argv[2];
  if (digest) {
    const tx = await reader.getTransaction(digest);
    console.log(`Tatum testnet read in ${Date.now() - t0} ms · ${tx?.status ?? "not found yet"} · digest ${digest}`);
    if (tx?.status !== "success") process.exitCode = 1;
  } else {
    const id = (await reader.client.core.getChainIdentifier()).chainIdentifier;
    console.log(`Tatum testnet OK in ${Date.now() - t0} ms · chain ${id}`);
  }
  console.log(`key used: ${cfg.TATUM_TESTNET_API_KEY ? "TATUM_TESTNET_API_KEY" : "TATUM_API_KEY (mainnet key)"}`);
} catch (err) {
  process.exitCode = 1;
  const e = err as Error & { code?: string };
  console.log(`Tatum testnet FAILED (${e.code ?? "error"}): ${e.message.slice(0, 200)}`);
  console.log("If this is an auth error, copy the Testnet API key from the Tatum dashboard into TATUM_TESTNET_API_KEY.");
}

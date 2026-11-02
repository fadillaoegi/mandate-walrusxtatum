import { z } from "zod";

const schema = z.object({
  API_PORT: z.coerce.number().default(8120),
  WEB_ORIGIN: z.string().default("http://localhost:5190"),
  DATABASE_URL: z.string().default("postgres://mandate:mandate@localhost:5450/mandate"),
  MEMWAL_SERVER_URL: z.string().url().default("https://relayer.memory.walrus.xyz"),
  MEMWAL_ACCOUNT_ID: z.string().default(""),
  MEMWAL_PRIVATE_KEY: z.string().default(""),
  /** Public half of the delegate key; shown in the UI as the delegate id. Not secret. */
  MEMWAL_PUBLIC_KEY: z.string().default(""),
  MEMWAL_NAMESPACE: z.string().default("mandate-demo"),
  /** grpc (default; Sui deprecated JSON-RPC in 2026) or jsonrpc (legacy fallback). */
  TATUM_SUI_TRANSPORT: z.enum(["grpc", "jsonrpc"]).default("grpc"),
  TATUM_SUI_GRPC_URL: z.string().url().default("https://sui-mainnet-grpc.gateway.tatum.io"),
  TATUM_SUI_RPC_URL: z.string().url().default("https://sui-mainnet.gateway.tatum.io"),
  TATUM_API_KEY: z.string().default(""),
  MEMORY_MODE: z.enum(["local", "walrus"]).default("local"),
  /** x402-local: real x402 protocol, settled on a local ledger (default). simulated: legacy rail D. */
  PAYMENT_RAIL: z.enum(["x402-local", "x402-testnet", "simulated"]).default("x402-local"),
  /** Agent wallet for x402-testnet (test tokens only). Create with: npm run wallet:testnet -w server -- init */
  AGENT_WALLET_PRIVATE_KEY: z.string().default(""),
  TATUM_SUI_TESTNET_GRPC_URL: z.string().url().default("https://sui-testnet-grpc.gateway.tatum.io"),
  /** Tatum may issue a separate testnet key; falls back to TATUM_API_KEY. */
  TATUM_TESTNET_API_KEY: z.string().default(""),
  /** 127.0.0.1 for local dev; 0.0.0.0 inside the container. */
  HOST: z.string().default("127.0.0.1"),
  /** When set, the API also serves the built web app from this folder (production). */
  WEB_DIST: z.string().default(""),
  /**
   * When set, every action that writes memory or changes state needs this passcode
   * (header x-demo-passcode). Viewing stays open. Protects the owner's Walrus quota on a public URL.
   */
  DEMO_PASSCODE: z.string().default(""),
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (): Config => schema.parse(process.env);

/** Throws with the names (never the values) of missing settings. */
export function requireKeys<K extends keyof Config>(cfg: Config, keys: K[]): void {
  const missing = keys.filter((k) => !cfg[k]);
  if (missing.length) throw new Error(`Missing in .env: ${missing.join(", ")}`);
}

/** Resolve the Testnet key before creating a client; a Mainnet key is only a fallback. */
export function testnetTatumConfig(
  cfg: Pick<Config, "TATUM_SUI_TESTNET_GRPC_URL" | "TATUM_TESTNET_API_KEY" | "TATUM_API_KEY">,
) {
  const apiKey = cfg.TATUM_TESTNET_API_KEY || cfg.TATUM_API_KEY;
  if (!apiKey) throw new Error("Missing in .env: TATUM_TESTNET_API_KEY or TATUM_API_KEY");
  return { grpcUrl: cfg.TATUM_SUI_TESTNET_GRPC_URL, apiKey, network: "testnet" as const };
}

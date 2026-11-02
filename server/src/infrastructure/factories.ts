import { WalrusMemoryStore } from "../adapters/memory/walrus-memory-store.js";
import { TatumSuiReader } from "../adapters/chain/tatum-sui-reader.js";
import { TatumSuiGrpcReader } from "../adapters/chain/tatum-sui-grpc-reader.js";
import { type Config, requireKeys } from "./config.js";

export function makeWalrus(cfg: Config): WalrusMemoryStore {
  requireKeys(cfg, ["MEMWAL_PRIVATE_KEY", "MEMWAL_ACCOUNT_ID"]);
  return new WalrusMemoryStore({
    privateKey: cfg.MEMWAL_PRIVATE_KEY,
    accountId: cfg.MEMWAL_ACCOUNT_ID,
    serverUrl: cfg.MEMWAL_SERVER_URL,
    namespace: cfg.MEMWAL_NAMESPACE,
  });
}

export function makeTatum(cfg: Config): TatumSuiGrpcReader | TatumSuiReader {
  requireKeys(cfg, ["TATUM_API_KEY"]);
  return cfg.TATUM_SUI_TRANSPORT === "grpc"
    ? new TatumSuiGrpcReader({ grpcUrl: cfg.TATUM_SUI_GRPC_URL, apiKey: cfg.TATUM_API_KEY, network: "mainnet" })
    : new TatumSuiReader({ rpcUrl: cfg.TATUM_SUI_RPC_URL, apiKey: cfg.TATUM_API_KEY });
}

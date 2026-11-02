import { SuiGrpcClient } from "@mysten/sui/grpc";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import { ChannelCredentials } from "@grpc/grpc-js";
import type { ChainReader, SuiTxSummary } from "../../ports/chain-reader.js";

export interface TatumGrpcConfig {
  grpcUrl: string;
  apiKey: string;
  network: "mainnet" | "testnet";
}

/**
 * Sui gRPC through the Tatum gateway (Sui deprecated JSON-RPC in 2026).
 * The API key is sent as gRPC metadata and never leaves this class.
 */
export class TatumSuiGrpcReader implements ChainReader {
  readonly source: string;
  /** Exposed so the x402 rail can settle through the same Tatum connection. */
  readonly client: SuiGrpcClient;

  constructor(cfg: TatumGrpcConfig) {
    this.source = `Tatum Sui gRPC (${cfg.network === "mainnet" ? "Mainnet" : "Testnet"})`;
    // Tatum's gateway speaks native gRPC (HTTP/2, application/grpc), not gRPC-web.
    const url = new URL(cfg.grpcUrl);
    const transport = new GrpcTransport({
      host: `${url.hostname}:${url.port || 443}`,
      channelCredentials: url.protocol === "http:" ? ChannelCredentials.createInsecure() : ChannelCredentials.createSsl(),
      meta: { "x-api-key": cfg.apiKey },
    });
    this.client = new SuiGrpcClient({ network: cfg.network, transport });
  }

  async getTransaction(digest: string): Promise<SuiTxSummary | null> {
    let res;
    try {
      res = await this.client.core.getTransaction({ digest, include: { balanceChanges: true, transaction: true } });
    } catch (err) {
      if (err instanceof Error && /not.?found|could not find/i.test(err.message)) return null;
      // System transactions cannot be decoded as programmable ones; read them without the body.
      if (!(err instanceof Error && /only programmable/i.test(err.message))) throw err;
      res = await this.client.core.getTransaction({ digest, include: { balanceChanges: true } });
    }
    const tx = res.Transaction ?? res.FailedTransaction;
    if (!tx) return null;
    return {
      digest: tx.digest,
      status: tx.status.success ? "success" : "failure",
      error: tx.status.success ? null : (tx.status.error?.message ?? "unknown error"),
      sender: (tx.transaction as { sender?: string | null } | undefined)?.sender ?? null,
      timestampMs: tx.timestampMs,
      checkpoint: tx.checkpoint,
      balanceChanges: (tx.balanceChanges ?? []).map((c) => ({
        owner: c.address,
        coinType: c.coinType,
        amount: BigInt(c.amount),
      })),
    };
  }

  async getBalance(address: string, coinType = "0x2::sui::SUI"): Promise<bigint> {
    const r = await this.client.core.getBalance({ owner: address, coinType });
    return BigInt(r.balance.balance);
  }

  /** A digest from the latest checkpoint (index 0 is a system tx); used by the spike to find a real tx to read. */
  async latestTxDigest(): Promise<string | null> {
    const { response } = await this.client.ledgerService.getCheckpoint({
      checkpointId: { oneofKind: undefined }, // latest
      readMask: { paths: ["transactions.digest"] },
    });
    const txs = response.checkpoint?.transactions ?? [];
    return (txs[1] ?? txs[0])?.digest ?? null; // [0] is the consensus prologue
  }
}

import type { ChainReader, SuiTxSummary } from "../../ports/chain-reader.js";

export interface TatumConfig {
  rpcUrl: string;
  apiKey: string;
}

interface RpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

/** Legacy Sui JSON-RPC through the Tatum gateway (fallback; prefer TatumSuiGrpcReader). The API key never leaves this class. */
export class TatumSuiReader implements ChainReader {
  readonly source = "Tatum Sui RPC (Mainnet)";
  constructor(private readonly cfg: TatumConfig) {}

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.cfg.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.cfg.apiKey },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`Tatum ${method} HTTP ${res.status}`);
    const body = (await res.json()) as RpcResponse<T>;
    if (body.error) throw new Error(`Tatum ${method}: ${body.error.message}`);
    return body.result as T;
  }

  async getTransaction(digest: string): Promise<SuiTxSummary | null> {
    type Tx = {
      digest: string;
      timestampMs?: string;
      checkpoint?: string;
      transaction?: { data?: { sender?: string } };
      effects?: { status?: { status: "success" | "failure"; error?: string } };
      balanceChanges?: { owner: { AddressOwner?: string } | string; coinType: string; amount: string }[];
    };
    let tx: Tx;
    try {
      tx = await this.rpc<Tx>("sui_getTransactionBlock", [
        digest,
        { showInput: true, showEffects: true, showBalanceChanges: true },
      ]);
    } catch (err) {
      if (err instanceof Error && /not.?found|could not find/i.test(err.message)) return null;
      throw err;
    }
    return {
      digest: tx.digest,
      status: tx.effects?.status?.status ?? "failure",
      error: tx.effects?.status?.error ?? null,
      sender: tx.transaction?.data?.sender ?? null,
      timestampMs: tx.timestampMs ? Number(tx.timestampMs) : null,
      checkpoint: tx.checkpoint ?? null,
      balanceChanges: (tx.balanceChanges ?? []).map((c) => ({
        owner: typeof c.owner === "string" ? c.owner : (c.owner.AddressOwner ?? "unknown"),
        coinType: c.coinType,
        amount: BigInt(c.amount),
      })),
    };
  }

  async getBalance(address: string, coinType = "0x2::sui::SUI"): Promise<bigint> {
    const r = await this.rpc<{ totalBalance: string }>("suix_getBalance", [address, coinType]);
    return BigInt(r.totalBalance);
  }

  /** Latest checkpoint digest list; used by the spike to find a real tx to read. */
  async latestTxDigest(): Promise<string | null> {
    const r = await this.rpc<{ data: { digest: string }[] }>("suix_queryTransactionBlocks", [
      { filter: null, options: {} },
      null,
      1,
      true,
    ]);
    return r.data[0]?.digest ?? null;
  }
}

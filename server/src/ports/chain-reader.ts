/** Read-only view of Sui. Production adapter: Tatum Sui RPC. */
export interface SuiTxSummary {
  digest: string;
  status: "success" | "failure";
  error: string | null;
  sender: string | null;
  timestampMs: number | null;
  checkpoint: string | null;
  /** Net balance changes per owner and coin type (raw units, signed). */
  balanceChanges: { owner: string; coinType: string; amount: bigint }[];
}

export interface ChainReader {
  /** Shown to users as the source of truth, e.g. "Tatum Sui RPC". */
  readonly source: string;
  getTransaction(digest: string): Promise<SuiTxSummary | null>;
  getBalance(address: string, coinType?: string): Promise<bigint>;
}

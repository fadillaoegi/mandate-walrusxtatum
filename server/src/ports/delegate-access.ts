/**
 * The owner's control over the agents' delegate key. In Walrus Memory the
 * delegate public key is registered on the owner's MemWalAccount; removing
 * it in the Memory dashboard cuts every agent that holds the key off.
 */
export type RevokedBy = "owner_in_app" | "memory_store";

export interface DelegateStatus {
  delegateId: string;
  active: boolean;
  changedAt: string | null;
  /** Who cut the key off: the owner's button here, or the memory store refusing it (HTTP 401). */
  revokedBy: RevokedBy | null;
  /** Last explicit check against the memory store, if any. */
  checkedAt: string | null;
  /** True when check() can ask the real memory store. */
  canCheck: boolean;
}

export interface DelegateAccess {
  status(): Promise<DelegateStatus>;
  revoke(): Promise<DelegateStatus>;
  /** Clear the cut-off (demo convenience). A key removed in the Walrus dashboard must be added there again. */
  restore(): Promise<DelegateStatus>;
  /** Record that the memory store refused the key on a normal call. Costs no request. */
  reportRejected(): Promise<DelegateStatus>;
  /** Ask the memory store whether it still accepts the key: one light request, only on demand. */
  check(): Promise<DelegateStatus>;
}

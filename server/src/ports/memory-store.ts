import type { MemoryEvent } from "../domain/memory-events.js";

export interface StoredMemory {
  event: MemoryEvent;
  blobId: string | null;
}

/** Portable agent memory. Production adapter: Walrus Memory (Mainnet). */
export interface MemoryStore {
  /** Shown to users, e.g. "Walrus Memory (Mainnet)". */
  readonly label: string;
  /** Memories are isolated per namespace; a new demo run uses a fresh one. */
  readonly namespace: string;
  useNamespace(namespace: string): void;
  /** Slow on Walrus (~20 s). The idempotency key makes retries safe. */
  remember(event: MemoryEvent, opts?: { idempotencyKey?: string }): Promise<{ blobId: string }>;
  /** Load every Mandate memory in the current namespace. */
  recallAll(): Promise<StoredMemory[]>;
  /** One light authenticated request: does the store still accept our key? Absent for stores without keys. */
  verifyAccess?(): Promise<boolean>;
}

/** The memory store refused the delegate key (e.g. Walrus relayer HTTP 401: key removed from the account). */
export class MemoryAccessDeniedError extends Error {}

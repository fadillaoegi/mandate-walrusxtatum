import type { Decision, PurchaseRequest } from "../domain/model.js";
import type { MemoryEvent } from "../domain/memory-events.js";
import type { PaymentProof } from "./payment-rail.js";

export type RequestStatus =
  | "auto_approved"
  | "auto_rejected"
  | "awaiting_owner"
  | "owner_approved"
  | "owner_rejected";

export interface PaymentInfo extends PaymentProof {
  status: "verified" | "failed" | "unknown";
  checkedBy: string;
  /** Why the payment did not happen (rail refused, merchant rejected). */
  error?: string | null;
  /** Payment was submitted, but the independent chain read was unavailable. */
  verificationError?: string | null;
}

export interface RequestRecord {
  id: string;
  agentId: string;
  sessionNumber: number;
  request: PurchaseRequest;
  decision: Decision;
  /** What the same agent would do with no memory at all. */
  withoutMemory: Decision;
  memoriesUsed: number;
  status: RequestStatus;
  ownerReason: string | null;
  payment: PaymentInfo | null;
  createdAt: string;
}

export type MemoryWriteStatus = "pending" | "stored" | "failed";

export interface MemoryIndexEntry {
  /** Stable local id; also the idempotency key sent to the memory store. */
  ref: string;
  /** Set once the memory store confirms the write. */
  blobId: string | null;
  status: MemoryWriteStatus;
  error: string | null;
  namespace: string;
  store: string;
  event: MemoryEvent;
  text: string;
  writtenBy: string;
  createdAt: string;
}

/** Application data in PostgreSQL. Not a substitute for the memory store. */
export interface AppRepository {
  saveRequest(r: RequestRecord): Promise<void>;
  getRequest(id: string): Promise<RequestRecord | null>;
  listRequests(): Promise<RequestRecord[]>;
  indexMemory(m: MemoryIndexEntry): Promise<void>;
  updateMemory(ref: string, patch: { blobId: string | null; status: MemoryWriteStatus; error: string | null }): Promise<void>;
  /** Memories of the given namespace, oldest first. */
  listMemoryIndex(namespace: string): Promise<MemoryIndexEntry[]>;
  /** Writes that never got a blob id (pending at shutdown, or failed). */
  listUnconfirmed(): Promise<MemoryIndexEntry[]>;
  nextSessionNumber(agentId: string): Promise<number>;
  /** Demo run counter; survives resets so each run gets a fresh memory namespace. */
  currentRun(): Promise<number>;
  nextRun(): Promise<number>;
  resetDemo(): Promise<void>;
}

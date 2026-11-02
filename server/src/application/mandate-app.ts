import { randomUUID } from "node:crypto";
import { type Knowledge, type MandateRules, type PurchaseRequest, emptyKnowledge } from "../domain/model.js";
import { type MemoryEvent, encode, fold } from "../domain/memory-events.js";
import { evaluate } from "../domain/policy.js";
import { MemoryAccessDeniedError, type MemoryStore } from "../ports/memory-store.js";
import type { ChainReader } from "../ports/chain-reader.js";
import { PaymentRefusedError, type PaymentProof, type PaymentRail } from "../ports/payment-rail.js";
import type { AppRepository, MemoryIndexEntry, PaymentInfo, RequestRecord } from "../ports/app-repository.js";
import type { Catalog } from "../ports/catalog.js";
import type { DelegateAccess, DelegateStatus } from "../ports/delegate-access.js";

export interface AgentSession {
  agentId: string;
  number: number;
  startedAt: string;
  recalled: number;
  /** Events this session knows: recalled at start plus what happened since. */
  events: MemoryEvent[];
}

export interface OwnerDecisionInput {
  approve: boolean;
  reason: string;
  tooExpensive: boolean;
  flagVendor: boolean;
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class AccessRevokedError extends Error {}

export interface AuditFinding {
  itemId: string;
  digest: string;
  remembered: string;
  onChain: string;
  corrected: boolean;
}

/**
 * Application service: orchestrates agents, the policy, memory, payments and
 * chain verification. Depends only on ports.
 */
export class MandateApp {
  /** Agent sessions live in process memory on purpose: a restart forgets them. */
  private readonly sessions = new Map<string, AgentSession>();

  constructor(
    private readonly deps: {
      memory: MemoryStore;
      chain: ChainReader;
      rail: PaymentRail;
      repo: AppRepository;
      catalog: Catalog;
      access: DelegateAccess;
      /** Each demo run writes to `<namespaceBase>-run<n>`. */
      namespaceBase: string;
      /** Parallel writes to the memory store (Walrus takes ~20 s per write). */
      writeConcurrency?: number;
      /** A fresh tx may take a moment to be readable on a real chain; extra reads, 1 s apart. */
      verifyRetries?: number;
      clock?: () => Date;
    },
  ) {}

  /** Background writes to the memory store that have not settled yet. */
  private readonly inFlight = new Set<Promise<void>>();
  private readonly waiting: (() => void)[] = [];
  private running = 0;

  private now(): string {
    return (this.deps.clock?.() ?? new Date()).toISOString();
  }

  // ---------- memory ----------

  /**
   * Record a memory. The agent and the index know it at once; the slow write to
   * the memory store runs in the background (status pending → stored | failed).
   */
  private async write(event: MemoryEvent, writtenBy: string, session?: AgentSession): Promise<string> {
    const entry: MemoryIndexEntry = {
      ref: randomUUID(),
      blobId: null,
      status: "pending",
      error: null,
      namespace: this.deps.memory.namespace,
      store: this.deps.memory.label,
      event,
      text: encode(event),
      writtenBy,
      createdAt: event.at,
    };
    await this.deps.repo.indexMemory(entry);
    session?.events.push(event);
    this.persist(entry);
    return entry.ref;
  }

  private persist(entry: MemoryIndexEntry): void {
    const job = (async () => {
      await this.slot();
      try {
        const { blobId } = await this.deps.memory.remember(entry.event, { idempotencyKey: entry.ref });
        await this.deps.repo.updateMemory(entry.ref, { blobId, status: "stored", error: null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.deps.repo.updateMemory(entry.ref, { blobId: null, status: "failed", error: msg.slice(0, 300) });
        if (err instanceof MemoryAccessDeniedError) await this.cutOff();
      } finally {
        this.release();
      }
    })().catch((err: unknown) => {
      // Only the index update can land here (e.g. database down); the entry stays unconfirmed and is retried at boot.
      console.error("memory index update failed:", err instanceof Error ? err.message : err);
    });
    this.inFlight.add(job);
    void job.finally(() => this.inFlight.delete(job));
  }

  private async slot(): Promise<void> {
    if (this.running < (this.deps.writeConcurrency ?? 3)) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running--;
  }

  /** Wait until every background write has settled (stored or failed). */
  async flush(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  pendingWrites(): number {
    return this.inFlight.size;
  }

  /** Boot: select this run's namespace and retry writes that never got a blob id. */
  async init(): Promise<void> {
    this.deps.memory.useNamespace(`${this.deps.namespaceBase}-run${await this.deps.repo.currentRun()}`);
    for (const entry of await this.deps.repo.listUnconfirmed()) {
      if (entry.namespace !== this.deps.memory.namespace) continue;
      await this.deps.repo.updateMemory(entry.ref, { blobId: null, status: "pending", error: null });
      this.persist(entry); // same ref = same idempotency key, so a retry cannot duplicate
    }
  }

  /** Retry failed writes of the current run. */
  async retryFailed(): Promise<number> {
    const failed = (await this.deps.repo.listUnconfirmed()).filter(
      (e) => e.status === "failed" && e.namespace === this.deps.memory.namespace,
    );
    for (const entry of failed) {
      await this.deps.repo.updateMemory(entry.ref, { blobId: null, status: "pending", error: null });
      this.persist(entry);
    }
    return failed.length;
  }

  memoryIndex(): Promise<MemoryIndexEntry[]> {
    return this.deps.repo.listMemoryIndex(this.deps.memory.namespace);
  }

  // ---------- sessions ----------

  // ---------- delegate key ----------

  private async requireAccess(agentId: string): Promise<void> {
    const s = await this.deps.access.status();
    if (!s.active) {
      this.sessions.delete(agentId);
      throw new AccessRevokedError(
        s.revokedBy === "memory_store"
          ? `Walrus Memory rejected delegate key ${s.delegateId} (removed from the owner's account); ${agentId} can no longer read or write the owner's memory.`
          : `Delegate key ${s.delegateId} was revoked by the owner; ${agentId} can no longer read or write the owner's memory.`,
      );
    }
  }

  /** The memory store refused our key: record it and drop everything agents had loaded. */
  private async cutOff(): Promise<void> {
    await this.deps.access.reportRejected();
    this.sessions.clear();
  }

  /** Run a memory-store read; a refused key becomes an access error for the agent. */
  private async recallGuarded(agentId: string) {
    try {
      return await this.deps.memory.recallAll();
    } catch (err) {
      if (!(err instanceof MemoryAccessDeniedError)) throw err;
      await this.cutOff();
      await this.requireAccess(agentId); // throws the access error
      throw err;
    }
  }

  /** Owner-triggered check against the memory store (one light request). */
  async checkDelegate(): Promise<DelegateStatus> {
    const s = await this.deps.access.check();
    if (!s.active) this.sessions.clear();
    return s;
  }

  delegateStatus(): Promise<DelegateStatus> {
    return this.deps.access.status();
  }

  async revokeDelegate(): Promise<DelegateStatus> {
    const s = await this.deps.access.revoke();
    this.sessions.clear(); // agents lose what they had loaded, too
    return s;
  }

  restoreDelegate(): Promise<DelegateStatus> {
    return this.deps.access.restore();
  }

  async startSession(agentId: string): Promise<AgentSession> {
    await this.requireAccess(agentId);
    if (!this.deps.catalog.agents().some((a) => a.id === agentId)) {
      throw new NotFoundError(`Unknown agent ${agentId}`);
    }
    await this.flush(); // a new session must read back what the store really holds
    await this.requireAccess(agentId); // a write may have just been refused
    const memories = await this.recallGuarded(agentId);
    const session: AgentSession = {
      agentId,
      number: await this.deps.repo.nextSessionNumber(agentId),
      startedAt: this.now(),
      recalled: memories.length,
      events: memories.map((m) => m.event),
    };
    this.sessions.set(agentId, session);
    return session;
  }

  private async session(agentId: string): Promise<AgentSession> {
    return this.sessions.get(agentId) ?? (await this.startSession(agentId));
  }

  sessionOf(agentId: string): AgentSession | null {
    return this.sessions.get(agentId) ?? null;
  }

  // ---------- owner ----------

  async setMandate(rules: MandateRules): Promise<string> {
    return this.write({ kind: "mandate_set", at: this.now(), rules }, "owner");
  }

  async ownerDecide(requestId: string, input: OwnerDecisionInput): Promise<RequestRecord> {
    const record = await this.deps.repo.getRequest(requestId);
    if (!record) throw new NotFoundError(`Unknown request ${requestId}`);
    if (record.status !== "awaiting_owner") throw new ConflictError("Request already decided");
    if (input.approve) await this.requireAccess(record.agentId);

    // The agent learns the verdict only if it is running; otherwise it recalls it next session.
    const session = this.sessions.get(record.agentId);
    const { request } = record;
    const reason = input.reason.trim() || (input.approve ? "approved by owner" : "rejected by owner");

    await this.write(
      {
        kind: "owner_verdict",
        at: this.now(),
        vendor: request.vendor,
        itemId: request.itemId,
        price: request.price,
        verdict: input.approve ? "approved" : "rejected",
        reason,
        tooExpensive: !input.approve && input.tooExpensive,
      },
      "owner",
      session,
    );
    if (input.flagVendor) {
      await this.write({ kind: "vendor_flag", at: this.now(), vendor: request.vendor, reason }, "owner", session);
    }

    record.ownerReason = reason;
    record.status = input.approve ? "owner_approved" : "owner_rejected";
    if (input.approve) record.payment = await this.payAndVerify(request, session);
    await this.deps.repo.saveRequest(record);
    return record;
  }

  // ---------- agents ----------

  async runTask(agentId: string, taskId: string): Promise<RequestRecord[]> {
    const task = this.deps.catalog.task(taskId);
    if (!task || task.agentId !== agentId) throw new NotFoundError(`Unknown task ${taskId} for ${agentId}`);
    await this.requireAccess(agentId);
    const session = await this.session(agentId);
    const out: RequestRecord[] = [];

    for (const itemId of task.itemIds) {
      const item = this.deps.catalog.item(itemId);
      if (!item) continue;
      const request: PurchaseRequest = {
        id: randomUUID(),
        agentId,
        vendor: item.vendor,
        itemId: item.itemId,
        itemTitle: item.title,
        price: item.price,
        requestedAt: this.now(),
      };
      const knowledge = fold(session.events);
      const decision = evaluate(request, knowledge);
      const record: RequestRecord = {
        id: request.id,
        agentId,
        sessionNumber: session.number,
        request,
        decision,
        withoutMemory: evaluate(request, emptyKnowledge()),
        memoriesUsed: session.events.length,
        status:
          decision.verdict === "approve"
            ? "auto_approved"
            : decision.verdict === "reject"
              ? "auto_rejected"
              : "awaiting_owner",
        ownerReason: null,
        payment: null,
        createdAt: request.requestedAt,
      };
      if (decision.verdict === "approve") record.payment = await this.payAndVerify(request, session);
      await this.deps.repo.saveRequest(record);
      out.push(record);
    }
    return out;
  }

  /** Pay through the rail, then trust only what the chain reader confirms. */
  private async payAndVerify(request: PurchaseRequest, session?: AgentSession): Promise<PaymentInfo> {
    let proof: PaymentProof;
    try {
      proof = await this.deps.rail.pay({
        payer: request.agentId,
        vendor: request.vendor,
        resource: request.itemId,
        amount: request.price,
      });
    } catch (err) {
      // Nothing was charged, so there is no receipt to remember; the request shows why.
      const reason = err instanceof PaymentRefusedError ? err.message : `Payment error: ${err instanceof Error ? err.message : String(err)}`;
      return { rail: this.deps.rail.id, network: "-", digest: null, status: "failed", checkedBy: this.deps.rail.label, error: reason };
    }
    await this.write(
      {
        kind: "purchase_recorded",
        at: this.now(),
        itemId: request.itemId,
        vendor: request.vendor,
        price: request.price,
        digest: proof.digest,
      },
      request.agentId,
      session,
    );
    let tx = null;
    let readFailed = false;
    // A newly executed transaction can briefly be absent or unreadable from the gateway.
    // Retry only the read; never resubmit the payment.
    for (let i = 0; proof.digest && i <= (this.deps.verifyRetries ?? 0); i++) {
      if (i) await new Promise((r) => setTimeout(r, 1000));
      try {
        tx = await this.deps.chain.getTransaction(proof.digest);
        if (tx) break;
      } catch {
        readFailed = true;
      }
    }
    const status = tx ? (tx.status === "success" ? "verified" : "failed") : "unknown";
    if (status !== "unknown") {
      await this.write(
        {
          kind: "purchase_status",
          at: this.now(),
          itemId: request.itemId,
          digest: proof.digest,
          status,
          source: this.deps.chain.source,
        },
        request.agentId,
        session,
      );
    }
    return {
      ...proof,
      status,
      checkedBy: this.deps.chain.source,
      ...(status === "unknown" && readFailed ? {
        verificationError: "Chain verification is unavailable. Audit receipts before retrying this payment.",
      } : {}),
    };
  }

  /**
   * Re-check every receipt in memory against the chain. When the chain
   * disagrees, the chain wins and a correction memory is written.
   */
  async auditReceipts(): Promise<AuditFinding[]> {
    await this.flush();
    await this.requireAccess("auditor");
    const knowledge = fold((await this.recallGuarded("auditor")).map((m) => m.event));
    const requests = await this.deps.repo.listRequests();
    const findings: AuditFinding[] = [];

    for (const p of knowledge.purchases) {
      if (!p.digest) continue;
      const tx = await this.deps.chain.getTransaction(p.digest);
      const onChain = tx ? (tx.status === "success" ? "verified" : "failed") : "not found";
      const disagrees = onChain !== "not found" && onChain !== p.status;
      if (disagrees) {
        await this.write(
          {
            kind: "purchase_status",
            at: this.now(),
            itemId: p.itemId,
            digest: p.digest,
            status: onChain,
            source: this.deps.chain.source,
          },
          "auditor",
        );
        for (const s of this.sessions.values()) {
          s.events.push({ kind: "purchase_status", at: this.now(), itemId: p.itemId, digest: p.digest, status: onChain, source: this.deps.chain.source });
        }
        const r = requests.find((x) => x.payment?.digest === p.digest);
        if (r?.payment) {
          r.payment.status = onChain;
          r.payment.verificationError = null;
          await this.deps.repo.saveRequest(r);
        }
      }
      findings.push({ itemId: p.itemId, digest: p.digest, remembered: p.status, onChain, corrected: disagrees });
    }
    return findings;
  }

  // ---------- read model ----------

  knowledgeOf(agentId: string): Knowledge | null {
    const s = this.sessions.get(agentId);
    return s ? fold(s.events) : null;
  }

  /**
   * Start a fresh demo run. Walrus memories are permanent, so instead of
   * deleting anything we move to a new namespace; old runs stay on Walrus.
   */
  async reset(): Promise<string> {
    await this.flush();
    this.sessions.clear();
    await this.deps.repo.resetDemo();
    this.deps.memory.useNamespace(`${this.deps.namespaceBase}-run${await this.deps.repo.nextRun()}`);
    return this.deps.memory.namespace;
  }
}

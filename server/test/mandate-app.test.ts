import { describe, expect, it } from "vitest";
import { MandateApp } from "../src/application/mandate-app.js";
import { DemoCatalog } from "../src/adapters/demo/demo-catalog.js";
import type { MemoryEvent } from "../src/domain/memory-events.js";
import { usd } from "../src/domain/model.js";
import { MemoryAccessDeniedError, type MemoryStore, type StoredMemory } from "../src/ports/memory-store.js";
import type { ChainReader } from "../src/ports/chain-reader.js";
import { PaymentRefusedError, type PaymentRail } from "../src/ports/payment-rail.js";
import type { DelegateAccess, DelegateStatus, RevokedBy } from "../src/ports/delegate-access.js";
import type { AppRepository, MemoryIndexEntry, RequestRecord } from "../src/ports/app-repository.js";

class FakeMemory implements MemoryStore {
  readonly label = "fake";
  namespace = "ns";
  byNs = new Map<string, StoredMemory[]>();
  keys: (string | undefined)[] = [];
  failNext = 0;
  /** Simulates the owner removing the delegate key in the Walrus dashboard. */
  keyRemoved = false;
  /** When set, writes hang until it resolves (simulates Walrus' ~20 s). */
  gate: Promise<void> | null = null;
  get stored() {
    return this.byNs.get(this.namespace) ?? [];
  }
  useNamespace(ns: string) {
    this.namespace = ns;
  }
  async remember(event: MemoryEvent, opts?: { idempotencyKey?: string }) {
    this.keys.push(opts?.idempotencyKey);
    if (this.gate) await this.gate;
    if (this.keyRemoved) throw new MemoryAccessDeniedError("401 from relayer");
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("relayer timeout");
    }
    const list = this.stored;
    const blobId = `b${list.length}`;
    this.byNs.set(this.namespace, [...list, { event, blobId }]);
    return { blobId };
  }
  async recallAll() {
    if (this.keyRemoved) throw new MemoryAccessDeniedError("401 from relayer");
    return [...this.stored];
  }
}

class FakeRepo implements AppRepository {
  requests = new Map<string, RequestRecord>();
  index: MemoryIndexEntry[] = [];
  sessions = new Map<string, number>();
  async saveRequest(r: RequestRecord) { this.requests.set(r.id, structuredClone(r)); }
  async getRequest(id: string) { const r = this.requests.get(id); return r ? structuredClone(r) : null; }
  async listRequests() { return [...this.requests.values()]; }
  run = 1;
  async indexMemory(m: MemoryIndexEntry) { this.index.push({ ...m }); }
  async updateMemory(ref: string, p: Pick<MemoryIndexEntry, "blobId" | "status" | "error">) {
    const e = this.index.find((x) => x.ref === ref);
    if (e) Object.assign(e, p);
  }
  async listMemoryIndex(ns: string) { return this.index.filter((x) => x.namespace === ns); }
  async listUnconfirmed() { return this.index.filter((x) => x.status !== "stored"); }
  async currentRun() { return this.run; }
  async nextRun() { return ++this.run; }
  async nextSessionNumber(agentId: string) { const n = (this.sessions.get(agentId) ?? 0) + 1; this.sessions.set(agentId, n); return n; }
  async resetDemo() { this.index = []; this.requests.clear(); }
}

class FakeAccess implements DelegateAccess {
  active = true;
  revokedBy: RevokedBy | null = null;
  constructor(private readonly verify?: () => Promise<boolean>) {}
  async status(): Promise<DelegateStatus> {
    return { delegateId: "test-key", active: this.active, changedAt: null, revokedBy: this.revokedBy, checkedAt: null, canCheck: Boolean(this.verify) };
  }
  async revoke() { this.active = false; this.revokedBy = "owner_in_app"; return this.status(); }
  async restore() { this.active = true; this.revokedBy = null; return this.status(); }
  async reportRejected() { this.active = false; this.revokedBy = "memory_store"; return this.status(); }
  async check() {
    if (!this.verify) return this.status();
    if (!(await this.verify())) return this.reportRejected();
    if (this.revokedBy !== "owner_in_app") { this.active = true; this.revokedBy = null; }
    return this.status();
  }
}

const rail: PaymentRail = { id: "D", label: "fake rail", pay: async (r) => ({ rail: "D", network: "test", digest: `tx-${r.resource}` }) };
const chain: ChainReader = {
  source: "fake chain",
  getTransaction: async (digest) => ({ digest, status: "success", error: null, sender: null, timestampMs: 0, checkpoint: null, balanceChanges: [] }),
  getBalance: async () => 0n,
};

function setup() {
  const memory = new FakeMemory();
  const repo = new FakeRepo();
  let t = Date.parse("2026-11-03T08:00:00Z");
  const app = new MandateApp({ memory, chain, rail, repo, catalog: new DemoCatalog(), access: new FakeAccess(), namespaceBase: "t", clock: () => new Date((t += 1000)) });
  return { app, memory, repo };
}

describe("demo flow 1-4", () => {
  it("asks first, then decides from memory in a new session and in another agent", async () => {
    const { app, memory } = setup();
    await app.setMandate({ maxPerItem: usd(0.5), maxPerDay: usd(2), blockedVendors: ["ShadyData"] });

    const first = await app.runTask("research-agent", "research-brief");
    expect(first.map((r) => r.status)).toEqual(["awaiting_owner", "awaiting_owner", "awaiting_owner"]);
    const [a, b, c] = first;
    await app.ownerDecide(a!.id, { approve: true, reason: "useful", tooExpensive: false, flagVendor: false });
    await app.ownerDecide(b!.id, { approve: false, reason: "too expensive", tooExpensive: true, flagVendor: false });
    await app.ownerDecide(c!.id, { approve: false, reason: "stale data", tooExpensive: false, flagVendor: true });

    const session = await app.startSession("research-agent");
    expect(session.number).toBe(2);
    expect(session.recalled).toBe(memory.stored.length);

    const second = await app.runTask("research-agent", "research-update");
    expect(second.map((r) => r.decision.reason)).toEqual([
      "DUPLICATE_PURCHASE",
      "TRUSTED_VENDOR_WITHIN_LIMITS",
      "FLAGGED_VENDOR",
      "LEARNED_PRICE_CEILING",
      "BLOCKED_VENDOR",
    ]);
    expect(second.every((r) => r.withoutMemory.verdict === "ask_owner")).toBe(true);

    const shopping = await app.runTask("shopping-agent", "shopping-dashboard");
    expect(shopping.map((r) => r.decision.reason)).toEqual([
      "DUPLICATE_PURCHASE",
      "TRUSTED_VENDOR_WITHIN_LIMITS",
      "FLAGGED_VENDOR",
      "OVER_ITEM_LIMIT",
    ]);
    await app.flush();
    expect(memory.stored.length).toBeGreaterThanOrEqual(10);
  });

  it("refuses to decide the same request twice", async () => {
    const { app } = setup();
    const [r] = await app.runTask("research-agent", "research-brief");
    const input = { approve: true, reason: "", tooExpensive: false, flagVendor: false };
    await app.ownerDecide(r!.id, input);
    await expect(app.ownerDecide(r!.id, input)).rejects.toThrow("already decided");
  });
});

describe("demo flow 5-6", () => {
  it("corrects a remembered purchase when the chain says the payment failed", async () => {
    const memory = new FakeMemory();
    const repo = new FakeRepo();
    const failed = new Set<string>();
    const ledgerChain: ChainReader = {
      ...chain,
      getTransaction: async (digest) => ({ ...(await chain.getTransaction(digest))!, status: failed.has(digest) ? "failure" : "success" }),
    };
    let t = Date.parse("2026-11-03T08:00:00Z");
    const app = new MandateApp({ memory, chain: ledgerChain, rail, repo, catalog: new DemoCatalog(), access: new FakeAccess(), namespaceBase: "t", clock: () => new Date((t += 1000)) });
    await app.setMandate({ maxPerItem: usd(0.5), maxPerDay: usd(2), blockedVendors: [] });
    const [r] = await app.runTask("research-agent", "research-brief");
    const decided = await app.ownerDecide(r!.id, { approve: true, reason: "", tooExpensive: false, flagVendor: false });
    expect(decided.payment?.status).toBe("verified");

    // The chain later turns out to disagree with memory.
    failed.add(decided.payment!.digest!);
    const findings = await app.auditReceipts();
    expect(findings).toEqual([expect.objectContaining({ remembered: "verified", onChain: "failed", corrected: true })]);
    expect((await app.auditReceipts())[0]?.corrected).toBe(false); // idempotent

    // No longer a duplicate: the agent may buy it again in a new session.
    await app.startSession("research-agent");
    const again = await app.runTask("research-agent", "research-update");
    expect(again[0]?.decision.reason).toBe("TRUSTED_VENDOR_WITHIN_LIMITS");
  });

  it("cuts agents off when the owner revokes the delegate key", async () => {
    const access = new FakeAccess();
    const app = new MandateApp({ memory: new FakeMemory(), chain, rail, repo: new FakeRepo(), catalog: new DemoCatalog(), access, namespaceBase: "t" });
    await app.startSession("shopping-agent");
    await app.revokeDelegate();
    expect(app.sessionOf("shopping-agent")).toBeNull();
    await expect(app.runTask("shopping-agent", "shopping-dashboard")).rejects.toThrow("revoked");
    await expect(app.startSession("research-agent")).rejects.toThrow("revoked");
    await app.restoreDelegate();
    await expect(app.startSession("research-agent")).resolves.toBeTruthy();
  });
});

describe("slow memory store (Walrus)", () => {
  it("knows a memory at once, then confirms it with a blob id in the background", async () => {
    const { app, memory, repo } = setup();
    await app.init();
    expect(memory.namespace).toBe("t-run1");
    let open!: () => void;
    memory.gate = new Promise((r) => (open = r));
    const ref = await app.setMandate({ maxPerItem: usd(0.5), maxPerDay: usd(2), blockedVendors: [] });
    expect(repo.index[0]).toMatchObject({ ref, status: "pending", blobId: null, namespace: "t-run1" });
    expect(app.pendingWrites()).toBe(1);
    open();
    await app.flush();
    expect(repo.index[0]).toMatchObject({ status: "stored", blobId: "b0" });
    expect(memory.keys).toEqual([ref]); // the ref doubles as idempotency key
  });

  it("marks failed writes and retries them with the same idempotency key", async () => {
    const { app, memory, repo } = setup();
    await app.init();
    memory.failNext = 1;
    const ref = await app.setMandate({ maxPerItem: usd(0.5), maxPerDay: usd(2), blockedVendors: [] });
    await app.flush();
    expect(repo.index[0]).toMatchObject({ status: "failed", error: "relayer timeout" });
    expect(await app.retryFailed()).toBe(1);
    await app.flush();
    expect(repo.index[0]).toMatchObject({ status: "stored" });
    expect(memory.keys).toEqual([ref, ref]);
  });

  it("a new session waits for pending writes, so it recalls them from the store", async () => {
    const { app } = setup();
    await app.init();
    await app.setMandate({ maxPerItem: usd(0.5), maxPerDay: usd(2), blockedVendors: [] });
    const s = await app.startSession("research-agent");
    expect(s.recalled).toBe(1);
  });

  it("a new demo run moves to a fresh namespace instead of deleting memories", async () => {
    const { app, memory } = setup();
    await app.init();
    await app.setMandate({ maxPerItem: usd(0.5), maxPerDay: usd(2), blockedVendors: [] });
    expect(await app.reset()).toBe("t-run2");
    expect((await app.startSession("research-agent")).recalled).toBe(0);
    expect(memory.byNs.get("t-run1")).toHaveLength(1); // still there
  });
});

describe("delegate key removed in the Walrus dashboard", () => {
  function build() {
    const memory = new FakeMemory();
    const access = new FakeAccess(async () => !memory.keyRemoved);
    const app = new MandateApp({ memory, chain, rail, repo: new FakeRepo(), catalog: new DemoCatalog(), access, namespaceBase: "t" });
    return { app, memory, access };
  }

  it("a refused recall cuts the agent off with the store's reason", async () => {
    const { app, memory, access } = build();
    memory.keyRemoved = true;
    await expect(app.startSession("research-agent")).rejects.toThrow("Walrus Memory rejected");
    expect(access.revokedBy).toBe("memory_store");
  });

  it("a refused background write marks the memory failed and cuts every agent off", async () => {
    const { app, memory, access } = build();
    await app.startSession("shopping-agent");
    memory.keyRemoved = true;
    await app.setMandate({ maxPerItem: usd(0.5), maxPerDay: usd(2), blockedVendors: [] });
    await app.flush();
    expect(access.active).toBe(false);
    expect(app.sessionOf("shopping-agent")).toBeNull();
    await expect(app.runTask("shopping-agent", "shopping-dashboard")).rejects.toThrow("Walrus Memory rejected");
  });

  it("check() asks the store; an in-app revoke still stands when the store accepts the key", async () => {
    const { app, memory } = build();
    memory.keyRemoved = true;
    expect((await app.checkDelegate()).revokedBy).toBe("memory_store");
    memory.keyRemoved = false;
    expect((await app.checkDelegate()).active).toBe(true); // key added back in the dashboard
    await app.revokeDelegate();
    expect((await app.checkDelegate()).revokedBy).toBe("owner_in_app");
  });
});

describe("payment refused by the rail", () => {
  it("records why, charges nothing and writes no receipt to memory", async () => {
    const memory = new FakeMemory();
    const refusing: PaymentRail = {
      id: "A",
      label: "x402 test",
      pay: async () => {
        throw new PaymentRefusedError("Merchant asked $0.35 but Mandate approved $0.25; agent refused to sign");
      },
    };
    const app = new MandateApp({ memory, chain, rail: refusing, repo: new FakeRepo(), catalog: new DemoCatalog(), access: new FakeAccess(), namespaceBase: "t" });
    await app.setMandate({ maxPerItem: usd(0.5), maxPerDay: usd(2), blockedVendors: [] });
    const [r] = await app.runTask("research-agent", "research-brief");
    const decided = await app.ownerDecide(r!.id, { approve: true, reason: "", tooExpensive: false, flagVendor: false });
    expect(decided.payment).toMatchObject({ status: "failed", digest: null, error: expect.stringContaining("refused to sign") });
    await app.flush();
    expect(memory.stored.map((m) => m.event.kind)).not.toContain("purchase_recorded");
  });
});

describe("chain verification after a submitted payment", () => {
  it("retries a transient chain read error without submitting the payment twice", async () => {
    const memory = new FakeMemory();
    let reads = 0;
    let payments = 0;
    const flakyChain: ChainReader = {
      ...chain,
      getTransaction: async (digest) => {
        if (++reads === 1) throw new Error("temporarily not indexed");
        return chain.getTransaction(digest);
      },
    };
    const countingRail: PaymentRail = { ...rail, pay: async (request) => { payments++; return rail.pay(request); } };
    const app = new MandateApp({
      memory, repo: new FakeRepo(), chain: flakyChain, rail: countingRail,
      catalog: new DemoCatalog(), access: new FakeAccess(), namespaceBase: "t", verifyRetries: 1,
    });
    await app.setMandate({ maxPerItem: usd(0.5), maxPerDay: usd(2), blockedVendors: [] });
    const [request] = await app.runTask("research-agent", "research-brief");
    const decided = await app.ownerDecide(request!.id, { approve: true, reason: "", tooExpensive: false, flagVendor: false });
    expect(decided.payment?.status).toBe("verified");
    expect(reads).toBe(2);
    expect(payments).toBe(1);
    await app.flush();
  });

  it.each(["unavailable", "not indexed"])("keeps the receipt and prevents repurchase when the chain is %s", async (outage) => {
    const memory = new FakeMemory();
    const repo = new FakeRepo();
    let healthy = false;
    let payments = 0;
    const countingRail: PaymentRail = { ...rail, pay: async (request) => { payments++; return rail.pay(request); } };
    const delayedChain: ChainReader = {
      ...chain,
      getTransaction: async (digest) => {
        if (healthy) return chain.getTransaction(digest);
        if (outage === "unavailable") throw new Error("gateway unavailable");
        return null;
      },
    };
    let t = Date.parse("2026-11-03T08:00:00Z");
    const app = new MandateApp({
      memory, repo, chain: delayedChain, rail: countingRail, catalog: new DemoCatalog(),
      access: new FakeAccess(), namespaceBase: "t", clock: () => new Date((t += 1000)),
    });
    await app.setMandate({ maxPerItem: usd(0.5), maxPerDay: usd(2), blockedVendors: [] });
    const [request] = await app.runTask("research-agent", "research-brief");
    const decided = await app.ownerDecide(request!.id, { approve: true, reason: "", tooExpensive: false, flagVendor: false });
    expect(decided.payment).toMatchObject({ status: "unknown", digest: "tx-os-coffee-exports" });
    if (outage === "unavailable") expect(decided.payment?.verificationError).toContain("Audit receipts");
    expect((await repo.getRequest(request!.id))?.payment?.digest).toBe("tx-os-coffee-exports");
    expect(app.knowledgeOf("research-agent")?.purchases[0]?.status).toBe("pending");

    // Re-running the same task does not charge a second time while verification is unknown.
    const repeated = await app.runTask("research-agent", "research-brief");
    expect(repeated[0]?.decision.reason).toBe("DUPLICATE_PURCHASE");
    expect(payments).toBe(1);

    // An explicit audit recovers both request state and memory without submitting another payment.
    healthy = true;
    expect(await app.auditReceipts()).toEqual([
      expect.objectContaining({ remembered: "pending", onChain: "verified", corrected: true }),
    ]);
    expect((await repo.getRequest(request!.id))?.payment).toMatchObject({ status: "verified", verificationError: null });
    expect(app.knowledgeOf("research-agent")?.purchases[0]?.status).toBe("verified");
    expect(payments).toBe(1);
    await app.flush();
  });
});

import { MemWal } from "@mysten-incubation/memwal";
import { type MemoryEvent, decode, encode } from "../../domain/memory-events.js";
import { MemoryAccessDeniedError, type MemoryStore, type StoredMemory } from "../../ports/memory-store.js";

/** The relayer answers 401 when the delegate key is not (or no longer) registered on the account. */
function denied(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  return e?.status === 401 || /^401\b|\b401 from relayer/.test(e?.message ?? "");
}

async function guard<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (denied(err)) throw new MemoryAccessDeniedError("Walrus Memory rejected the delegate key (HTTP 401): it is not registered on this account.");
    throw err;
  }
}

export interface WalrusConfig {
  privateKey: string;
  accountId: string;
  serverUrl: string;
  namespace: string;
}

/** The relayer caps recall at 100 nearest memories per query. */
const RECALL_LIMIT = 100;
/** Recall is semantic; extra angles only matter once a namespace holds more than RECALL_LIMIT memories. */
const EXTRA_QUERIES = [
  "owner approved or rejected purchase",
  "vendor flagged as bad",
  "purchased item tx",
  "purchase status failed verified",
];

export class WalrusMemoryStore implements MemoryStore {
  readonly label = "Walrus Memory (Mainnet)";
  private readonly client: MemWal;
  private ns: string;

  constructor(cfg: WalrusConfig) {
    this.ns = cfg.namespace;
    this.client = MemWal.create({
      key: cfg.privateKey,
      accountId: cfg.accountId,
      serverUrl: cfg.serverUrl,
      namespace: cfg.namespace,
    });
  }

  get namespace() {
    return this.ns;
  }

  useNamespace(namespace: string) {
    this.ns = namespace;
  }

  health() {
    return this.client.health();
  }

  publicKeyHex() {
    return this.client.getPublicKeyHex();
  }

  async remember(event: MemoryEvent, opts: { idempotencyKey?: string } = {}): Promise<{ blobId: string }> {
    const res = await guard(() =>
      this.client.rememberAndWait(encode(event), this.ns, { idempotencyKey: opts.idempotencyKey, timeoutMs: 180_000 }),
    );
    return { blobId: res.blob_id };
  }

  /** One light authenticated request (no embedding): list at most one namespace. */
  async verifyAccess(): Promise<boolean> {
    try {
      await guard(() => this.client.listNamespaces({ limit: 1 } as never));
      return true;
    } catch (err) {
      if (err instanceof MemoryAccessDeniedError) return false;
      throw err;
    }
  }

  async recallAll(): Promise<StoredMemory[]> {
    const seen = new Map<string, StoredMemory>();
    const take = async (query: string) => {
      const res = await guard(() => this.client.recall({ query, limit: RECALL_LIMIT, namespace: this.ns }));
      for (const hit of res.results) {
        const event = decode(hit.text);
        if (event && !seen.has(hit.blob_id)) seen.set(hit.blob_id, { event, blobId: hit.blob_id });
      }
      return res.results.length;
    };
    const first = await take("owner spending mandate limits blocked vendors");
    if (first >= RECALL_LIMIT) for (const q of EXTRA_QUERIES) await take(q);
    return [...seen.values()];
  }
}

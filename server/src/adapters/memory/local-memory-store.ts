import { randomBytes } from "node:crypto";
import type { Db } from "../persistence/db.js";
import { decode, encode, type MemoryEvent } from "../../domain/memory-events.js";
import type { MemoryStore, StoredMemory } from "../../ports/memory-store.js";

/**
 * Stand-in for Walrus Memory while keys are not configured. Same text
 * encoding, persisted in Postgres so it survives restarts. Clearly labelled.
 */
export class LocalMemoryStore implements MemoryStore {
  readonly label = "Local store (dev only, not Walrus)";

  constructor(private readonly db: Db, private ns: string) {}

  get namespace() {
    return this.ns;
  }

  useNamespace(namespace: string) {
    this.ns = namespace;
  }

  async remember(event: MemoryEvent): Promise<{ blobId: string }> {
    const blobId = `local-${randomBytes(8).toString("hex")}`;
    await this.db.query("insert into local_memories (blob_id, namespace, text) values ($1, $2, $3)", [
      blobId,
      this.ns,
      encode(event),
    ]);
    return { blobId };
  }

  async recallAll(): Promise<StoredMemory[]> {
    const res = await this.db.query<{ blob_id: string; text: string }>(
      "select blob_id, text from local_memories where namespace = $1 order by id",
      [this.ns],
    );
    return res.rows.flatMap((r) => {
      const event = decode(r.text);
      return event ? [{ event, blobId: r.blob_id }] : [];
    });
  }
}

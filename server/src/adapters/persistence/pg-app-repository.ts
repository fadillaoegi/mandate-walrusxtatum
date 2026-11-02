import type { Db } from "./db.js";
import type { AppRepository, MemoryIndexEntry, MemoryWriteStatus, RequestRecord } from "../../ports/app-repository.js";
import type { MemoryEvent } from "../../domain/memory-events.js";

export class PgAppRepository implements AppRepository {
  constructor(private readonly db: Db) {}

  async saveRequest(r: RequestRecord): Promise<void> {
    await this.db.query(
      `insert into requests (id, created_at, data) values ($1, $2, $3)
       on conflict (id) do update set data = excluded.data`,
      [r.id, r.createdAt, JSON.stringify(r)],
    );
  }

  async getRequest(id: string): Promise<RequestRecord | null> {
    const res = await this.db.query<{ data: RequestRecord }>("select data from requests where id = $1", [id]);
    return res.rows[0]?.data ?? null;
  }

  async listRequests(): Promise<RequestRecord[]> {
    const res = await this.db.query<{ data: RequestRecord }>("select data from requests order by created_at, id");
    return res.rows.map((r) => r.data);
  }

  async indexMemory(m: MemoryIndexEntry): Promise<void> {
    await this.db.query(
      `insert into memory_log (ref, blob_id, status, error, namespace, store, written_by, text, event, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (ref) do nothing`,
      [m.ref, m.blobId, m.status, m.error, m.namespace, m.store, m.writtenBy, m.text, JSON.stringify(m.event), m.createdAt],
    );
  }

  async updateMemory(ref: string, p: { blobId: string | null; status: MemoryWriteStatus; error: string | null }): Promise<void> {
    await this.db.query("update memory_log set blob_id = $2, status = $3, error = $4 where ref = $1", [
      ref,
      p.blobId,
      p.status,
      p.error,
    ]);
  }

  private async listWhere(where: string, params: unknown[]): Promise<MemoryIndexEntry[]> {
    const res = await this.db.query<{
      ref: string; blob_id: string | null; status: MemoryWriteStatus; error: string | null; namespace: string;
      store: string; written_by: string; text: string; event: MemoryEvent; created_at: Date;
    }>(`select * from memory_log where ${where} order by created_at, ref`, params);
    return res.rows.map((r) => ({
      ref: r.ref,
      blobId: r.blob_id,
      status: r.status,
      error: r.error,
      namespace: r.namespace,
      store: r.store,
      writtenBy: r.written_by,
      text: r.text,
      event: r.event,
      createdAt: r.created_at.toISOString(),
    }));
  }

  listMemoryIndex(namespace: string): Promise<MemoryIndexEntry[]> {
    return this.listWhere("namespace = $1", [namespace]);
  }

  listUnconfirmed(): Promise<MemoryIndexEntry[]> {
    return this.listWhere("status <> 'stored'", []);
  }

  async currentRun(): Promise<number> {
    const res = await this.db.query<{ run: number }>("select run from demo_run where id = 1");
    return res.rows[0]?.run ?? 1;
  }

  async nextRun(): Promise<number> {
    const res = await this.db.query<{ run: number }>("update demo_run set run = run + 1 where id = 1 returning run");
    return res.rows[0]!.run;
  }

  async nextSessionNumber(agentId: string): Promise<number> {
    await this.db.query("insert into agent_sessions (agent_id) values ($1)", [agentId]);
    const res = await this.db.query<{ n: string }>(
      "select count(*) as n from agent_sessions where agent_id = $1",
      [agentId],
    );
    return Number(res.rows[0]?.n ?? 1);
  }

  async resetDemo(): Promise<void> {
    await this.db.query(
      // demo_run is kept on purpose: the next run must use a fresh namespace.
      "truncate requests, memory_log, agent_sessions, local_memories, local_ledger, delegate_state restart identity",
    );
  }
}

import type { Db } from "../persistence/db.js";
import type { DelegateAccess, DelegateStatus, RevokedBy } from "../../ports/delegate-access.js";

/**
 * Delegate state kept in Postgres. With a verifier (Walrus mode) it can also ask
 * the memory store whether the key is still registered; it never polls.
 */
export class LocalDelegateAccess implements DelegateAccess {
  constructor(
    private readonly db: Db,
    private readonly delegateId: string,
    private readonly verify?: () => Promise<boolean>,
  ) {}

  async status(): Promise<DelegateStatus> {
    const res = await this.db.query<{ active: boolean; changed_at: Date; revoked_by: RevokedBy | null; checked_at: Date | null }>(
      "select active, changed_at, revoked_by, checked_at from delegate_state where delegate_id = $1",
      [this.delegateId],
    );
    const row = res.rows[0];
    return {
      delegateId: this.delegateId,
      active: row?.active ?? true,
      changedAt: row?.changed_at.toISOString() ?? null,
      revokedBy: row?.active === false ? (row.revoked_by ?? "owner_in_app") : null,
      checkedAt: row?.checked_at?.toISOString() ?? null,
      canCheck: Boolean(this.verify),
    };
  }

  private async set(active: boolean, revokedBy: RevokedBy | null, checked = false): Promise<DelegateStatus> {
    await this.db.query(
      `insert into delegate_state (delegate_id, active, revoked_by, changed_at, checked_at)
       values ($1, $2, $3, now(), case when $4 then now() end)
       on conflict (delegate_id) do update set
         active = excluded.active,
         revoked_by = excluded.revoked_by,
         changed_at = case when delegate_state.active = excluded.active then delegate_state.changed_at else now() end,
         checked_at = coalesce(excluded.checked_at, delegate_state.checked_at)`,
      [this.delegateId, active, revokedBy, checked],
    );
    return this.status();
  }

  revoke() {
    return this.set(false, "owner_in_app");
  }

  restore() {
    return this.set(true, null);
  }

  reportRejected() {
    return this.set(false, "memory_store");
  }

  async check(): Promise<DelegateStatus> {
    if (!this.verify) return this.status();
    const current = await this.status();
    const accepted = await this.verify();
    if (!accepted) return this.set(false, "memory_store", true);
    // The store accepts the key again (re-added in the dashboard); an in-app revoke still stands.
    if (current.revokedBy === "owner_in_app") return this.set(false, "owner_in_app", true);
    return this.set(true, null, true);
  }
}

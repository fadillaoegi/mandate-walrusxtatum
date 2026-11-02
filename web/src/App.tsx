import { useCallback, useEffect, useState } from "react";
import { type AppState, OfflineError, api, passcode } from "./api";
import { MandatePanel } from "./components/MandatePanel";
import { OwnerInbox } from "./components/OwnerInbox";
import { AgentCard } from "./components/AgentCard";
import { Timeline } from "./components/Timeline";
import { MemoryPanel } from "./components/MemoryPanel";
import { Comparison } from "./components/Comparison";
import { Sprite } from "./components/Sprite";
import { DelegatePanel } from "./components/DelegatePanel";
import { ChainPanel } from "./components/ChainPanel";
import { GuidedDemo } from "./components/GuidedDemo";
import type { AuditFinding } from "./api";

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  /** Result of the last action; stays until dismissed or the next action. */
  const [error, setError] = useState<string | null>(null);
  /** Background polling problem; clears itself when the API answers again. */
  const [offline, setOffline] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [findings, setFindings] = useState<AuditFinding[] | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [pass, setPass] = useState(passcode.get());

  const refresh = useCallback(async () => {
    try {
      setState(await api.state());
      setOffline(null);
    } catch (e) {
      setOffline(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Poll faster while memories are still being written to the store.
  const pendingWrites = state?.pendingWrites ?? 0;
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), pendingWrites > 0 ? 2000 : 5000);
    return () => clearInterval(t);
  }, [refresh, pendingWrites]);

  const act = async (fn: () => Promise<unknown>, done?: string, doing?: string) => {
    setBusy(true);
    setWorking(doing ?? null);
    setError(null);
    try {
      await fn();
      if (done) setToast(done);
      await refresh();
    } catch (e) {
      if (e instanceof OfflineError) setOffline(e.message);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setWorking(null);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const local = state?.modes.memory === "local";
  const modeLabel = state?.modes.chain === "tatum"
    ? (local ? "Local memory · Sui Testnet payments" : "Walrus Mainnet memory · Sui Testnet payments")
    : (local ? "Local mode" : state?.demo.rail === "D" ? "Walrus Mainnet memory · simulated payments" : "Walrus Mainnet memory · local payment ledger");
  const recallHint = local ? "Recalling memories…" : "Waiting for pending writes, then recalling from Walrus Mainnet (~10–40 s)…";
  const pending = state?.requests.filter((r) => r.status === "awaiting_owner") ?? [];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Sprite name="chest" size={56} />
          <div>
            <h1 className="px-title text-xl text-coin sm:text-2xl">Mandate</h1>
            <p className="mt-1 text-lg text-dim">Your money rules, remembered by every agent you hire.</p>
          </div>
        </div>
        {state?.passcodeRequired && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              passcode.set(pass.trim());
              setError(null);
              setToast(pass.trim() ? "Passcode saved for this browser" : "View-only");
            }}
          >
            <span className="text-dim">{passcode.get() ? "Demo unlocked" : "View-only demo"}</span>
            <input
              className="px-input w-40"
              type="password"
              placeholder="Demo passcode"
              aria-label="Demo passcode"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
            <button className="px-btn" type="submit">Unlock</button>
          </form>
        )}
        {state && (
          <button
            className="px-btn px-btn-ruby"
            disabled={busy}
            onClick={() =>
              window.confirm(
                local
                  ? "Start a new demo run? Local demo data is cleared."
                  : "Start a new demo run? Nothing is deleted from Walrus: the next run writes to a fresh namespace.",
              ) && void act(() => { setFindings(null); return api.reset(); }, "New demo run started", "Finishing pending writes…")
            }
          >
            New demo run
          </button>
        )}
      </header>

      {state && (
        <div
          className="px-box mb-6 flex flex-wrap gap-x-6 gap-y-1 p-3"
          style={{ ["--b" as string]: local ? "var(--color-coin)" : "var(--color-leaf)" }}
          role="status"
        >
          <span className="px-title text-[11px]" style={{ color: local ? "var(--color-coin)" : "var(--color-leaf)" }}>
            {modeLabel}
          </span>
          <span>Memory: {state.labels.memory}</span>
          <span>Chain check: {state.labels.chain}</span>
          <span>Payments: {state.labels.rail}</span>
          {state.pendingWrites > 0 && <span className="px-blink text-coin">{state.pendingWrites} write(s) in flight</span>}
        </div>
      )}

      {state && <GuidedDemo state={state} />}

      {working && (
        <p className="px-box mb-6 p-3 text-coin" style={{ ["--b" as string]: "var(--color-coin)" }} role="status">
          <span className="px-blink">⏳</span> {working}
        </p>
      )}

      {offline && (
        <p className="px-box mb-6 p-3 text-ruby" style={{ ["--b" as string]: "var(--color-ruby)" }} role="alert">
          <span className="px-title text-[11px]">Offline</span> {offline} Retrying every few seconds…
        </p>
      )}

      {error && (
        <div className="px-box mb-6 flex items-start justify-between gap-3 p-3" style={{ ["--b" as string]: "var(--color-ruby)" }} role="alert">
          <p className="text-ruby">{error}</p>
          <button className="shrink-0 text-dim underline decoration-dotted hover:text-cream" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      {!state ? (
        <p className="px-title px-blink text-[11px] text-dim">{offline ? "Waiting for the API…" : "Loading…"}</p>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 xl:grid-cols-[1fr_1.25fr_1fr]">
          <div className="min-w-0 space-y-8">
            <MandatePanel
              mandate={state.mandate}
              busy={busy}
              onSave={(b) => void act(() => api.setMandate(b), "Mandate saved to memory")}
            />
            <OwnerInbox
              pending={pending}
              busy={busy}
              onDecide={(id, b) => void act(() => api.decide(id, b), b.approve ? "Approved & remembered" : "Rejected & remembered")}
            />
            <DelegatePanel
              delegate={state.delegate}
              busy={busy}
              onRevoke={() => void act(() => api.revoke(), "Delegate key revoked")}
              onRestore={() => void act(() => api.restore(), "Delegate key restored")}
              onCheck={() => void act(() => api.checkDelegate(), "Delegate key checked on Walrus", "Asking the Walrus relayer about this key…")}
            />
          </div>

          <div className="min-w-0 space-y-8">
            {state.agents.map((a, i) => (
              <AgentCard
                key={a.id}
                agent={a}
                revoked={!state.delegate.active}
                step={i === 0 ? "2" : "4"}
                busy={busy}
                onRun={(taskId) =>
                  void act(() => api.run(a.id, taskId), `${a.name} finished its task`, a.session ? `${a.name} is working…` : recallHint)
                }
                onNewSession={() => void act(() => api.newSession(a.id), `${a.name}: new session, memory reloaded`, recallHint)}
              />
            ))}
            <Timeline requests={state.requests} />
          </div>

          <div className="min-w-0 space-y-8 lg:col-span-2 xl:col-span-1">
            <ChainPanel
              chainLabel={state.labels.chain}
              railLabel={state.labels.rail}
              x402={state.demo.rail === "A"}
              failNextSupported={state.demo.failNextSupported}
              overchargeNext={state.demo.overchargeNext}
              onOvercharge={(v) => void act(() => api.overchargeNext(v), v ? "Merchant will overcharge the next request" : "Merchant back to listed prices")}
              failNext={state.demo.failNextPayment}
              busy={busy}
              findings={findings}
              onFailNext={(v) => void act(() => api.failNext(v), v ? "Next payment will fail on-chain" : "Payments back to normal")}
              onAudit={() => void act(async () => setFindings(await api.audit()), "Receipts audited on-chain", "Auditing every receipt in memory against the chain…")}
            />
            <MemoryPanel
              memories={state.memories}
              storeLabel={state.labels.memory}
              isWalrus={!local}
              namespace={state.namespace}
              busy={busy}
              onRetry={() => void act(() => api.retryMemories(), "Retrying failed writes")}
            />
            <Comparison requests={state.requests} />
          </div>
        </div>
      )}

      {toast && (
        <div className="px-box px-pop fixed bottom-4 left-1/2 z-10 -translate-x-1/2 px-4 py-2" style={{ ["--b" as string]: "var(--color-leaf)" }} role="status">
          <span className="px-title text-[11px] text-leaf">{toast}</span>
        </div>
      )}

      <footer className="mt-10 text-center text-sm text-dim">
        Demo merchant and agent task plans are scripted for the demo. The spending policy is deterministic; no model can override it.
      </footer>
    </div>
  );
}

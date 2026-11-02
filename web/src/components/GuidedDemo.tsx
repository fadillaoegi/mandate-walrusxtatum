import { useEffect, useState } from "react";
import type { AppState } from "../api";

interface Step {
  title: string;
  /** What to click. */
  todo: string;
  /** What changes on screen. */
  watch: string;
  /** One line to say in the video. */
  say: string;
  target: string;
  done: (s: AppState) => boolean;
}

const owner = (st: string) => st === "owner_approved" || st === "owner_rejected";

const STEPS: Step[] = [
  {
    title: "Set the owner's money rules",
    todo: "In 1 · Owner mandate keep $0.50 per item, $2.00 per day, block ShadyData, then press Save to memory.",
    watch: "A RULE memory appears in the Memory vault.",
    say: "I give every agent I hire one set of money rules, kept as memory.",
    target: "panel-mandate",
    done: (s) => s.mandate !== null,
  },
  {
    title: "The first agent has to ask",
    todo:
      "Research Agent → Run task “Coffee market brief”. In Owner inbox: approve OpenStats, reject DataHarbor as too expensive, reject QuickFacts and flag it.",
    watch: "Each answer becomes a VERDICT or FLAG memory; the approved item is paid over x402.",
    say: "The first time, the agent has no history, so it asks me — and remembers my answers.",
    target: "panel-research-agent",
    done: (s) =>
      s.requests.some((r) => r.agentId === "research-agent" && owner(r.status)) &&
      !s.requests.some((r) => r.status === "awaiting_owner"),
  },
  {
    title: "A new session still remembers",
    todo: "Research Agent → New session (its RAM is wiped), then run “Weekly update”.",
    watch: "Decision log: duplicate, trusted vendor, flagged vendor, price ceiling, blocked vendor — none asked the owner.",
    say: "A fresh session starts empty, recalls my memory, and decides on its own.",
    target: "panel-research-agent",
    done: (s) => s.requests.some((r) => r.agentId === "research-agent" && r.sessionNumber >= 2 && !owner(r.status)),
  },
  {
    title: "A different agent obeys too",
    todo: "Shopping Agent → Run task “Datasets for a dashboard”.",
    watch: "Same rules and history, without teaching it anything.",
    say: "Any agent I hire with my delegate key follows the same memory.",
    target: "panel-shopping-agent",
    done: (s) => s.requests.some((r) => r.agentId === "shopping-agent"),
  },
  {
    title: "Never trust the merchant's word",
    todo:
      "In 5 · Payments tick “Greedy merchant” (or, on the local ledger, “tx fails on-chain”), then Shopping Agent → Run task “Price check”.",
    watch: "Greedy: the agent refuses to sign. Failed tx: the chain check writes a red CORRECTION memory.",
    say: "Agents only sign what I approved, and the chain — not the merchant — decides what was paid.",
    target: "panel-chain",
    done: (s) => s.requests.some((r) => r.payment && (r.payment.error || r.payment.status === "failed")),
  },
  {
    title: "The owner pulls the key",
    todo: "In 6 · Delegate key press Revoke key.",
    watch: "Both agents show ACCESS REVOKED; every call is refused.",
    say: "One click, and every agent loses access to my memory and my money.",
    target: "panel-delegate",
    done: (s) => !s.delegate.active,
  },
];

const HIDE_KEY = "mandate-guide-hidden";
const readHidden = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
};
const writeHidden = (v: boolean) => {
  try {
    localStorage.setItem(HIDE_KEY, v ? "1" : "0");
  } catch {
    /* private mode: just not remembered */
  }
};

export function spotlight(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.remove("px-spot");
  void el.offsetWidth; // restart the animation
  el.classList.add("px-spot");
  window.setTimeout(() => el.classList.remove("px-spot"), 2600);
}

export function GuidedDemo({ state }: { state: AppState }) {
  const [hidden, setHidden] = useState(readHidden);
  const done = STEPS.map((s) => s.done(state));
  const current = done.findIndex((d) => !d);
  const [viewing, setViewing] = useState<number | null>(null);
  const index = viewing ?? (current === -1 ? STEPS.length : current);

  // Follow progress again once the step being viewed is completed.
  useEffect(() => {
    if (viewing !== null && done[viewing]) setViewing(null);
  }, [viewing, done.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (hidden) {
    return (
      <button className="px-btn mb-6" onClick={() => { setHidden(false); writeHidden(false); }}>
        ▶ Guided demo
      </button>
    );
  }

  const step = STEPS[index];
  return (
    <section className="px-box mb-6 p-4" style={{ ["--b" as string]: "var(--color-coin)" }} aria-label="Guided demo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="px-title text-[13px] text-coin">Guided demo</h2>
        <ol className="flex flex-wrap gap-2" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button
                className="px-title px-2 py-1 text-[11px]"
                style={{
                  background: done[i] ? "var(--color-leaf)" : i === index ? "var(--color-coin)" : "var(--color-panel-2)",
                  color: done[i] || i === index ? "var(--color-night)" : "var(--color-dim)",
                }}
                aria-current={i === index ? "step" : undefined}
                aria-label={`Step ${i + 1}: ${s.title}${done[i] ? " (done)" : ""}`}
                onClick={() => setViewing(i)}
              >
                {i + 1}
              </button>
            </li>
          ))}
        </ol>
        <button className="text-dim underline decoration-dotted hover:text-cream" onClick={() => { setHidden(true); writeHidden(true); }}>
          hide
        </button>
      </div>

      {step ? (
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <p className="text-lg">
              <span className="text-coin">Step {index + 1}/{STEPS.length}</span> · <b>{step.title}</b>
              {done[index] && <span className="text-leaf"> · done</span>}
            </p>
            <p className="mt-1"><span className="text-dim">Do:</span> {step.todo}</p>
            <p className="mt-1"><span className="text-dim">Watch:</span> {step.watch}</p>
            <p className="mt-1 text-sky"><span className="text-dim">Say:</span> “{step.say}”</p>
          </div>
          <div className="flex items-start gap-3">
            <button className="px-btn px-btn-coin" onClick={() => spotlight(step.target)}>Show me</button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-lg text-leaf"><b>Demo complete.</b></p>
          <p className="mt-1">
            The <button className="text-sky underline" onClick={() => spotlight("panel-compare")}>without memory vs with Mandate</button>{" "}
            table sums it up. Press <b>New demo run</b> to rehearse again on a fresh memory namespace.
          </p>
        </div>
      )}
    </section>
  );
}

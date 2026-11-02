import type { ReactNode } from "react";

export function Panel({ id, title, accent = "var(--color-cream)", right, children, className = "" }: {
  /** Anchor for the guided demo ("Show me"). */
  id?: string;
  title: string;
  accent?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`px-box min-w-0 scroll-mt-4 p-4 ${className}`} style={{ ["--b" as string]: accent }}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="px-title text-[13px]" style={{ color: accent }}>{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}

const STATUS: Record<string, { label: string; color: string }> = {
  auto_approved: { label: "Auto-approved", color: "var(--color-leaf)" },
  auto_rejected: { label: "Auto-rejected", color: "var(--color-ruby)" },
  awaiting_owner: { label: "Ask owner", color: "var(--color-coin)" },
  owner_approved: { label: "Owner approved", color: "var(--color-leaf)" },
  owner_rejected: { label: "Owner rejected", color: "var(--color-ruby)" },
};

export function StatusTag({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, color: "var(--color-dim)" };
  return (
    <span className="px-title inline-block whitespace-nowrap px-1.5 py-1 text-[11px]" style={{ color: "var(--color-night)", background: s.color }}>
      {s.label}
    </span>
  );
}

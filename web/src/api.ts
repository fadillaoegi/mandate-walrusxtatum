export type Verdict = "approve" | "reject" | "ask_owner";
export type RequestStatus = "auto_approved" | "auto_rejected" | "awaiting_owner" | "owner_approved" | "owner_rejected";

export interface Decision {
  verdict: Verdict;
  reason: string;
  explanation: string;
}

export interface RequestRecord {
  id: string;
  agentId: string;
  sessionNumber: number;
  request: { vendor: string; itemId: string; itemTitle: string; price: number; requestedAt: string };
  decision: Decision;
  withoutMemory: Decision;
  memoriesUsed: number;
  status: RequestStatus;
  ownerReason: string | null;
  payment: {
    rail: string;
    network: string;
    digest: string | null;
    payer?: string | null;
    status: string;
    checkedBy: string;
    error?: string | null;
    verificationError?: string | null;
  } | null;
  createdAt: string;
}

export interface MemoryEntry {
  ref: string;
  blobId: string | null;
  status: "pending" | "stored" | "failed";
  error: string | null;
  namespace: string;
  store: string;
  event: { kind: string; at: string };
  text: string;
  writtenBy: string;
  createdAt: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  tasks: { id: string; title: string; items: number }[];
  session: { number: number; startedAt: string; recalled: number; known: number } | null;
}

export interface Rules {
  maxPerItem: number;
  maxPerDay: number;
  blockedVendors: string[];
}

export interface AppState {
  modes: { memory: "walrus" | "local"; chain: string; rail: string };
  namespace: string;
  pendingWrites: number;
  passcodeRequired: boolean;
  labels: { memory: string; chain: string; rail: string };
  mandate: Rules | null;
  agents: Agent[];
  requests: RequestRecord[];
  memories: MemoryEntry[];
  delegate: {
    delegateId: string;
    active: boolean;
    changedAt: string | null;
    revokedBy: "owner_in_app" | "memory_store" | null;
    checkedAt: string | null;
    canCheck: boolean;
  };
  demo: { failNextPayment: boolean; failNextSupported: boolean; overchargeNext: boolean; rail: "A" | "D" };
}

export interface AuditFinding {
  itemId: string;
  digest: string;
  remembered: string;
  onChain: string;
  corrected: boolean;
}

const PASS_KEY = "mandate-demo-passcode";
export const passcode = {
  get: () => { try { return localStorage.getItem(PASS_KEY) ?? ""; } catch { return ""; } },
  set: (v: string) => { try { localStorage.setItem(PASS_KEY, v); } catch { /* private mode */ } },
};

/** Network failures and 5xx come back as short, human messages. */
export class OfflineError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-demo-passcode": passcode.get(), ...init?.headers },
    });
  } catch {
    throw new OfflineError("Can't reach the Mandate API. Is the server running?");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status >= 500 && !body.error) throw new OfflineError("The Mandate API is not responding. Is the server running?");
    throw new Error(body.error ?? (res.status >= 500 ? "Something went wrong on the server. Check the API log." : `HTTP ${res.status}`));
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  state: () => call<AppState>("/state"),
  setMandate: (b: { maxPerItemUsd: number; maxPerDayUsd: number; blockedVendors: string[] }) => post("/mandate", b),
  newSession: (agentId: string) => post(`/agents/${agentId}/session`),
  run: (agentId: string, taskId: string) => post(`/agents/${agentId}/run`, { taskId }),
  decide: (id: string, b: { approve: boolean; reason: string; tooExpensive: boolean; flagVendor: boolean }) =>
    post(`/requests/${id}/decide`, b),
  reset: () => post<{ namespace: string }>("/demo/reset"),
  retryMemories: () => post<{ retried: number }>("/memories/retry"),
  revoke: () => post("/delegate/revoke"),
  restore: () => post("/delegate/restore"),
  checkDelegate: () => post<AppState["delegate"]>("/delegate/check"),
  audit: () => post<AuditFinding[]>("/audit"),
  failNext: (fail: boolean) => post("/demo/fail-next-payment", { fail }),
  overchargeNext: (on: boolean) => post("/demo/overcharge-next", { on }),
};

export const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

/** "TH12wq98iix4…3Qix": long ids stay recognisable without wrapping across lines. */
export const shortId = (id: string, head = 6, tail = 4) =>
  id.length > head + tail + 3 ? `${id.slice(0, head)}…${id.slice(-tail)}` : id;

/** Strip the "[mandate:v1]" tag and JSON payload, keeping the human sentence (long tx ids shortened). */
export const memorySentence = (text: string) =>
  text
    .replace(/^\[mandate:v1\]\s*/, "")
    .replace(/ \|\| \{"kind":.*$/, "")
    .replace(/[A-Za-z0-9_-]{24,}/g, (id) => shortId(id));

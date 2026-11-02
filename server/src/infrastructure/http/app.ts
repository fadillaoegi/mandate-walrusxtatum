import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Container } from "../container.js";
import { AccessRevokedError, ConflictError, NotFoundError } from "../../application/mandate-app.js";
import { usd } from "../../domain/model.js";

const mandateBody = z.object({
  maxPerItemUsd: z.number().positive().max(1000),
  maxPerDayUsd: z.number().positive().max(10000),
  blockedVendors: z.array(z.string().trim().min(1).max(60)).max(20),
});

const decideBody = z.object({
  approve: z.boolean(),
  reason: z.string().max(200).default(""),
  tooExpensive: z.boolean().default(false),
  flagVendor: z.boolean().default(false),
});

const runBody = z.object({ taskId: z.string().min(1) });

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

export function createApp(cfg: Config, c: Container) {
  const app = express();
  app.use(cors({ origin: cfg.WEB_ORIGIN }));
  app.use(express.json());

  // DEMO MERCHANT: our own x402 seller for the demo catalog (clearly labelled, not a real vendor).
  app.use("/merchant", c.merchant);

  // Public deploy: reads are open, state-changing calls need the demo passcode.
  const passcode = Buffer.from(cfg.DEMO_PASSCODE);
  app.use("/api", (req, res, next) => {
    if (!passcode.length || req.method === "GET") return next();
    const given = Buffer.from(String(req.header("x-demo-passcode") ?? ""));
    if (given.length === passcode.length && timingSafeEqual(given, passcode)) return next();
    res.status(401).json({ error: "This public demo is view-only. Enter the demo passcode to run agents." });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, modes: c.modes, namespace: c.memory.namespace, passcodeRequired: passcode.length > 0 });
  });

  app.get(
    "/api/state",
    wrap(async (_req, res) => {
      const [requests, memories, delegate] = await Promise.all([
        c.repo.listRequests(),
        c.app.memoryIndex(),
        c.app.delegateStatus(),
      ]);
      const latestMandate = [...memories].reverse().find((m) => m.event.kind === "mandate_set");
      res.json({
        modes: c.modes,
        passcodeRequired: passcode.length > 0,
        namespace: c.memory.namespace,
        pendingWrites: c.app.pendingWrites(),
        labels: { memory: c.memory.label, chain: c.chain.source, rail: c.rail.label },
        mandate: latestMandate?.event.kind === "mandate_set" ? latestMandate.event.rules : null,
        agents: c.catalog.agents().map((a) => {
          const s = c.app.sessionOf(a.id);
          return {
            ...a,
            tasks: c.catalog.tasks(a.id).map((t) => ({ id: t.id, title: t.title, items: t.itemIds.length })),
            session: s
              ? { number: s.number, startedAt: s.startedAt, recalled: s.recalled, known: s.events.length }
              : null,
          };
        }),
        delegate,
        demo: { failNextPayment: c.demoControl.willFailNext(), failNextSupported: c.demoControl.failNextSupported, overchargeNext: c.merchantControl.overchargeNext, rail: c.modes.rail },
        catalog: c.catalog.items(),
        requests,
        memories,
      });
    }),
  );

  app.post(
    "/api/mandate",
    wrap(async (req, res) => {
      const b = mandateBody.parse(req.body);
      const blobId = await c.app.setMandate({
        maxPerItem: usd(b.maxPerItemUsd),
        maxPerDay: usd(b.maxPerDayUsd),
        blockedVendors: b.blockedVendors,
      });
      res.status(201).json({ blobId });
    }),
  );

  app.post(
    "/api/agents/:agentId/session",
    wrap(async (req, res) => {
      const s = await c.app.startSession(String(req.params.agentId));
      res.status(201).json({ number: s.number, recalled: s.recalled });
    }),
  );

  app.post(
    "/api/agents/:agentId/run",
    wrap(async (req, res) => {
      const { taskId } = runBody.parse(req.body);
      res.status(201).json(await c.app.runTask(String(req.params.agentId), taskId));
    }),
  );

  app.post(
    "/api/requests/:id/decide",
    wrap(async (req, res) => {
      res.json(await c.app.ownerDecide(String(req.params.id), decideBody.parse(req.body)));
    }),
  );

  app.post(
    "/api/delegate/revoke",
    wrap(async (_req, res) => {
      res.json(await c.app.revokeDelegate());
    }),
  );

  app.post(
    "/api/delegate/restore",
    wrap(async (_req, res) => {
      res.json(await c.app.restoreDelegate());
    }),
  );

  // Owner-triggered only: one light request to the memory store. Never polled.
  app.post(
    "/api/delegate/check",
    wrap(async (_req, res) => {
      res.json(await c.app.checkDelegate());
    }),
  );

  app.post(
    "/api/audit",
    wrap(async (_req, res) => {
      res.json(await c.app.auditReceipts());
    }),
  );

  app.post(
    "/api/memories/retry",
    wrap(async (_req, res) => {
      res.json({ retried: await c.app.retryFailed() });
    }),
  );

  app.post("/api/demo/fail-next-payment", (req, res) => {
    const { fail } = z.object({ fail: z.boolean() }).parse(req.body);
    c.demoControl.setFailNext(fail);
    res.json({ failNextPayment: c.demoControl.willFailNext() });
  });

  app.post("/api/demo/overcharge-next", (req, res) => {
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    c.merchantControl.overchargeNext = on;
    res.json({ overchargeNext: on });
  });

  app.post(
    "/api/demo/reset",
    wrap(async (_req, res) => {
      // Nothing is deleted from Walrus: the next run simply uses a fresh namespace.
      // A fresh run also switches the demo controls off, so nothing leaks into the next rehearsal.
      c.merchantControl.overchargeNext = false;
      c.demoControl.setFailNext(false);
      res.json({ namespace: await c.app.reset() });
    }),
  );

  if (cfg.WEB_DIST) {
    const dist = path.resolve(cfg.WEB_DIST);
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: "Invalid input", issues: err.issues });
    if (err instanceof NotFoundError) return void res.status(404).json({ error: err.message });
    if (err instanceof AccessRevokedError) return void res.status(403).json({ error: err.message });
    if (err instanceof ConflictError) return void res.status(409).json({ error: err.message });
    console.error(err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Internal error" });
  });

  return app;
}

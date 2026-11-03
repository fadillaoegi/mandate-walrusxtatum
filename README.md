# Mandate

**Your money rules, remembered by every agent you hire.**

Built for **Total Recall — Tatum × Walrus** · Track: **Consumer Finance Apps**

- **Verification & On-Chain Evidence:** [docs/VERIFICATION.md](docs/VERIFICATION.md)
- **Sui Testnet x402 Payment Runbook:** [docs/TESTNET.md](docs/TESTNET.md)
- **Demo Video (2:39):** [youtu.be/sRa2cWtP8ok](https://youtu.be/sRa2cWtP8ok) — live run on Walrus Mainnet + x402 on Sui Testnet via Tatum
- **Blog Post:** [Giving AI Agents a Memory for Your Money Rules](https://dev.to/fadillaoegi/mandate-giving-ai-agents-a-memory-for-your-money-rules-2akk)

## Background

AI agents are starting to pay for things on their own through protocols such as
x402 and MPP: datasets, articles, API calls, subscriptions. The trouble is that
every agent starts from zero. It doesn't know its owner's spending limits, which
vendors let them down before, or what was already bought. So the owner either
approves every purchase by hand or lets the agent spend without any control.

Mandate keeps the owner's spending rules and purchase history as **portable
memory on Walrus**. Any agent given the owner's delegate key follows the same
rules, pays only what those rules allow, and **trusts the chain, not the
merchant**, about what was actually paid. When the chain disagrees with memory
(for example, a payment that actually failed), the on-chain truth corrects the
memory. The owner can cut every agent off by revoking one key.

## What the demo shows

The dashboard has a **Guided demo** card that walks through six steps, with a
line of narration for each:

1. **Set the money rules**: max per item, max per day, blocked vendors. Stored as memory.
2. **The first agent has to ask**: the Research Agent knows nothing yet, so the owner approves or rejects, and each answer becomes memory.
3. **A new session still remembers**: the agent's RAM is wiped, it recalls from Walrus and decides on its own (duplicate, trusted vendor, flagged vendor, learned price ceiling, blocked vendor).
4. **A different agent obeys too**: the Shopping Agent follows the same memory without being taught.
5. **Never trust the merchant's word**: payments use x402. A greedy merchant asking more than approved is refused; a payment the merchant calls "paid" but that failed on-chain is corrected in memory.
6. **The owner pulls the key**: revoking the delegate key cuts every agent off.

## How memory changes behaviour

| Situation | Without memory | With Mandate |
|---|---|---|
| First purchase from a vendor | Asks the owner | Same: the owner decides, and the reason is stored |
| Next session | Asks about everything again | Auto-approves trusted vendors within limits; rejects flagged and blocked vendors |
| Another agent | Starts from zero | Follows the same rules immediately (same delegate key) |
| Item bought before | Can buy it twice | Rejects the duplicate |
| Price the owner called "too expensive" | Asks again | Rejects at or above the learned ceiling |
| Merchant overcharges | Would pay | Refuses to sign more than Mandate approved |
| Merchant says "paid", chain says failed | Believes the merchant | Writes a correction; the item can be bought again |

The dashboard's *Without memory vs with Mandate* table counts these live.

## Architecture

Clean Architecture: the domain has no I/O; adapters plug into ports.

```
server/src/
  domain/          policy.ts (deterministic spending rules), memory-events.ts, model.ts
  application/     MandateApp: sessions, owner decisions, pay-then-verify, receipt audit, delegate key
  ports/           MemoryStore, ChainReader, PaymentRail, DelegateAccess, Catalog, AppRepository
  adapters/
    memory/        WalrusMemoryStore (Walrus Memory Mainnet relayer) · LocalMemoryStore (dev only)
    chain/         TatumSuiGrpcReader (Sui gRPC through the Tatum gateway)
    payment/       X402Rail (agent side, @t2000/sui-x402) · local ledger (dev) · SuiSettler (Testnet)
    merchant/      DEMO MERCHANT: our own x402 seller (HTTP 402 → verify → settle → deliver)
    persistence/   PostgreSQL (app data and a memory index; not a replacement for Walrus)
  infrastructure/  config, composition root, Express HTTP app
web/               React + TypeScript + Vite + Tailwind dashboard (pixel theme)
```

- **Policy first.** Every purchase request goes through `domain/policy.ts`. The
  demo's agent task plans are scripted; no language model is in the loop, and
  if one is added it can only suggest, never override the policy.
- **Memory as events.** Each memory is one immutable event (mandate set, owner
  verdict, vendor flag, purchase, on-chain status). Walrus Memory is
  append-only, so corrections are new events and knowledge is rebuilt by
  folding events in time order.
- **Slow store, fast app.** A Walrus write takes about 20 s. The agent knows a
  memory at once; the write runs in the background (`pending → stored`, or
  `failed` with a retry that reuses the same idempotency key). A new session
  waits for pending writes, then recalls from Walrus.
- **x402 with guardrails.** The agent signs a gasless USDC transfer only if the
  merchant's 402 terms match what Mandate approved: same amount, the vendor's
  known address, the expected network. One challenge, one payment: replays are
  refused. The agent derives the digest from the transaction it signed, so a
  lost or misleading merchant reply cannot replace that digest; Mandate checks
  the signed transaction on-chain before treating the payment as verified.
- **Verify, don't trust.** After paying, the app reads the transaction from the
  chain reader and stores *that* status in memory. If that read is unavailable,
  the payment stays pending with its digest and still counts toward limits;
  an explicit receipt audit can confirm it later without paying again.
- **Revocation without polling.** If the Walrus relayer answers 401 on any
  normal call, every agent is cut off. The owner can also check on demand
  (one request).
- Money is integer micro-USD (6 decimals, like USDC).

## Running locally

Requirements: Node 24 and Docker.

```bash
cp .env.example .env        # fill in your own keys locally (never commit .env)
npm install
npm run db:up               # Postgres 18 on localhost:5450
npm run dev:server          # API on http://localhost:8120
npm run dev:web             # dashboard on http://localhost:5190
npm test                    # domain, use-case and x402 tests
```

Modes (in `.env`):

| Setting | Values | Meaning |
|---|---|---|
| `MEMORY_MODE` | `local` (default) · `walrus` | Postgres stand-in (dev only) or Walrus Memory Mainnet |
| `PAYMENT_RAIL` | `x402-local` (default) · `x402-testnet` · `simulated` | x402 settled on a local ledger · real Sui Testnet settlement through Tatum · older simulated rail |
| `AGENT_WALLET_PRIVATE_KEY` | empty · Testnet wallet key | Required for `x402-testnet`; never reuse the demo wallet on Mainnet |
| `TATUM_TESTNET_API_KEY` | empty · Testnet API key | Testnet uses this key first, then falls back to `TATUM_API_KEY` |
| `DEMO_PASSCODE` | empty · any string | When set, the dashboard is view-only without the passcode |

The banner at the top of the dashboard always states which memory store, chain
check and payment rail are in use.

Offline tests use fake clients and exercise the real x402 signing, verification
and Express merchant routes without network requests. To also check localhost
HTTP transport in an environment that permits listening on ports:

```bash
MANDATE_TEST_HTTP=socket npm test
```

Live spike scripts below need `.env` and use your API keys. Ask the key owner
before running them. The default `spike:x402` signs and verifies offline; its
optional network simulation uses public fullnodes.

```bash
npm run spike:walrus-write -w server    # write one memory to Walrus Mainnet
npm run spike:walrus-recall -w server   # fresh process: recall and rebuild knowledge
npm run spike:tatum -w server [digest]  # read a Sui Mainnet tx through Tatum
npm run spike:x402 -w server [-- --network [--mainnet]]  # x402 build/verify; optional read-only simulate (no funds)
npm run spike:tatum-testnet -w server  # one Testnet gateway probe
npm run spike:tatum-testnet -w server -- <digest>  # re-read an existing Testnet payment
npm run spike:x402-testnet -w server   # one $0.08 Testnet USDC payment, about 4–7 Tatum requests
npm run spike:revoke-check -w server   # one Walrus access check using a disposable second delegate key
```

The [Testnet runbook](docs/TESTNET.md) covers funding, the required USDC address
balance, and how to recover an unconfirmed payment without submitting it again.

## Deploying

One image serves the API and the built web app. Secrets are passed at runtime, never baked in.

```bash
docker build -t mandate .
docker run -p 8080:8080 \
  -e DATABASE_URL=postgres://... -e MEMORY_MODE=walrus \
  -e MEMWAL_ACCOUNT_ID=... -e MEMWAL_PRIVATE_KEY=... -e MEMWAL_PUBLIC_KEY=... \
  -e DEMO_PASSCODE=... mandate
```

`DEMO_PASSCODE` keeps a public URL view-only: anyone can watch, only people with
the passcode can run agents (every run writes to the owner's Walrus Memory, so
the quota stays protected).

## Status

| Piece | State |
|---|---|
| Spending policy | Done, unit-tested |
| Demo flow 1–6 + guided demo | Works end to end |
| Walrus Memory (Mainnet) | **Live.** Initial Mainnet blob `-KHlB4hm8BKhOkkwEcUqwK7vt1iF0F9LiKXZ8c0b6JM`; full demo flow wrote **11 memories** to namespace `mandate-demo-run3`, recalled intact from a separate process |
| Delegate key revoke | Detected from the relayer's 401; owner check on demand |
| Tatum (Sui Mainnet) | **Live** read of Sui Mainnet transactions (e.g. `G246UN5xL4BgvbyJzq9s5gHT14uwAj4qyc3J4aTJFJqn`, checkpoint `340687333`) through Tatum's gRPC gateway (~51 ms) |
| Payments (x402 on Sui) | **Testnet proven for one purchase.** The demo merchant settled $0.08 USDC on Sui Testnet (digest `7Lszdc8FS4pLY6EQN9hUxGxc7Q6pKZNiXLfu91BWshwn`); Tatum independently read that digest as `success` (193 ms). The full guided demo has not been run on the Testnet rail |
| Tests | 37 passing (policy, use cases, async memory, revocation, x402 merchant/rail, Testnet configuration, public balance parsing and recovery after chain-read or merchant-reply failure) |
| Deploy | Docker image builds and runs; no public URL yet |

## Honest limits

- The demo merchant, its vendors and their addresses are ours and clearly
  labelled as a demo. Agent wallets in local mode are derived dev keys that
  hold nothing.
- The local ledger supports repeatable demo flows without spending funds. One
  live Testnet payment has been confirmed through Tatum; the full demo has not
  yet been exercised on that rail. Network and rail labels distinguish modes in the UI.
- Unknown chain status keeps the purchase reserved. Audit the existing digest
  before trying to pay again. A missing chain response is not proof of failure.
- Walrus memories are permanent. "New demo run" moves to a fresh namespace
  instead of deleting anything.
- The managed Walrus Memory relayer embeds and encrypts on the server side, so
  the operator sees plaintext. The demo uses sample data only.
- No secrets live in this repository. Keys stay in a local `.env`.

## License

MIT

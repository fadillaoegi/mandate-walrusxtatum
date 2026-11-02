# Verification, On-Chain Evidence & Guided Demo Walkthrough

This document maps **Mandate** against the **Total Recall — Tatum × Walrus** hackathon requirements, lists all public on-chain / Walrus identifiers produced during verification (with zero private keys or API secrets), and provides a step-by-step reviewer walkthrough.

---

## 1. Hackathon Requirements Mapping

| Total Recall Requirement | How Mandate Satisfies It | Where to Inspect |
|---|---|---|
| **Track: Consumer Finance Apps** | Owner-defined spending mandates, learned vendor ceilings, cross-agent budget enforcement, and gasless x402 USDC agent payments settled on Sui | `server/src/domain/policy.ts`, `server/src/adapters/payment/` |
| **Walrus Memory on Mainnet** | Uses `@mysten-incubation/memwal` against `https://relayer.memory.walrus.xyz` to append immutable spending rules, owner verdicts, vendor flags, receipts, and on-chain status corrections | `server/src/adapters/memory/walrus-memory-store.ts` |
| **At least 10 Mainnet memories** | **11 memories stored on Walrus Mainnet** in namespace `mandate-demo-run3` across the 6-step flow, recalled intact from a separate process to rebuild policy state | Section 2 below; `server/src/domain/memory-events.ts` |
| **Tatum RPC / gRPC for on-chain data** | Native HTTP/2 gRPC adapter (`TatumSuiGrpcReader`) reading Sui Mainnet (`sui-mainnet-grpc.gateway.tatum.io`) and Sui Testnet (`sui-testnet-grpc.gateway.tatum.io`) transactions and balances to verify payment truth independently of merchant claims | `server/src/adapters/chain/tatum-sui-grpc-reader.ts` |
| **Learning over time across sessions & agents** | Append-only events fold deterministically: an owner rejection marked *"too expensive"* establishes a vendor price ceiling; approved vendors become trusted within limits; a second agent (`Shopping Agent`) inherits all learned rules immediately via the shared delegate key | `server/test/policy.test.ts`, `server/test/mandate-app.test.ts` |
| **Agent Payments on Sui (x402)** | Built-in HTTP `402 Payment Required` merchant and agent `X402Rail` (`@t2000/sui-x402`) enforcing pre-signature amount, vendor address, and network guardrails, plus offline digest derivation before broadcast | `server/src/adapters/payment/`, `server/test/x402.test.ts` |

---

## 2. Recorded Live Evidence (Public Identifiers Only)

All keys remain strictly in local `.env` (git-ignored). Below are the public, non-secret artifacts from live verification runs:

### A. Walrus Memory (Mainnet)
- **Relayer:** `https://relayer.memory.walrus.xyz`
- **Single-memory Mainnet write & fresh-process recall spike (`spike:walrus-write` / `spike:walrus-recall`):**
  - Stored `mandate_set` event (`maxPerItem: $0.50`, `maxPerDay: $2.00`, `blockedVendors: ["ShadyData"]`)
  - **Walrus Mainnet Blob ID:** `-KHlB4hm8BKhOkkwEcUqwK7vt1iF0F9LiKXZ8c0b6JM` (written in 21.8 s; recalled in a fresh process in 12.3 s and folded back into identical rules)
- **Full 6-step flow on Walrus Mainnet:**
  - **Namespace:** `mandate-demo-run3`
  - **Stored count:** **11 Mainnet memories** (exceeding the 10-memory requirement), recalled intact from a separate process, including owner verdicts, vendor flag on `QuickFacts`, purchase receipts, and `failed → verified` chain-status reconciliation.
- **Delegate key access control:**
  - Unregistered delegate key tested against relayer → returned HTTP `401`, mapped to `MemoryAccessDeniedError` to cut off active agent sessions without background polling.

### B. Tatum Sui gRPC (Mainnet & Testnet)
- **Sui Mainnet transaction read via Tatum gRPC (`spike:tatum`):**
  - **Gateway:** `https://sui-mainnet-grpc.gateway.tatum.io`
  - **Transaction Digest:** `G246UN5xL4BgvbyJzq9s5gHT14uwAj4qyc3J4aTJFJqn` (Checkpoint `340687333`)
  - **Result:** Read status, sender, and balance changes in **51 ms**.
- **Sui Testnet gateway probe via Tatum gRPC (`spike:tatum-testnet`):**
  - **Gateway:** `https://sui-testnet-grpc.gateway.tatum.io`
  - **Chain ID:** `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD` (**263 ms**).

### C. x402 Gasless USDC Settlement on Sui Testnet + Tatum Verification
- **Public Demo Agent Wallet (Sui Testnet, test tokens only):**
  - `0xb9aa1344cf7c2de9b70d56cc7a3ec2285189729a687b98375fa99261100bd061`
- **USDC Coin-Object → Address-Balance Deposit (`0x2::coin::send_funds` on Sui Testnet):**
  - **Deposit Digest:** `7Uk9grcaSPtvMPdtqvinBcnhQntjwXhFYy1pPryDh2bs` (20.00 Testnet USDC moved into address balance required by gasless x402).
- **Controlled x402 Purchase & Independent Tatum Verification (`spike:x402-testnet` + `spike:tatum-testnet`):**
  - **Item:** QuickFacts demo dataset (`$0.08` Testnet USDC)
  - **Settlement Digest (`sui:testnet`):** `7Lszdc8FS4pLY6EQN9hUxGxc7Q6pKZNiXLfu91BWshwn` (settled via Tatum Testnet gRPC in 1026 ms)
  - **Independent Tatum gRPC Read:** `success` in **193 ms**.

> **Scope note:** The full 6-step guided dashboard flow was verified end-to-end on Walrus Mainnet paired with the deterministic local ledger, and x402 Sui Testnet settlement + Tatum verification was proven via the controlled `$0.08` USDC transaction above. Running the full 6-step UI scenario on `PAYMENT_RAIL=x402-testnet` is supported by the codebase (spending `$0.75` Testnet USDC across 3 approved items) and documented in [docs/TESTNET.md](TESTNET.md).

---

## 3. Zero-Key Reviewer Verification (Offline Test Suite)

Reviewers can verify all domain rules, Walrus memory event folding, recovery from chain-read outages, lost HTTP merchant replies, and real cryptographic x402 payment signing/verification **offline with zero API keys or Docker containers**:

```bash
npm install
npm run typecheck
npm test
```

Expected result: **37 passing tests** across 5 test suites (`policy`, `mandate-app`, `x402`, `config`, `public-balance`).

---

## 4. Six-Step Guided Dashboard Walkthrough

Start the local stack (`MEMORY_MODE=local` and `PAYMENT_RAIL=x402-local` work out of the box with zero external keys; switch to `walrus` / `x402-testnet` in `.env` when using live keys):

```bash
cp .env.example .env
npm run db:up
npm run dev:server
npm run dev:web
```

Open `http://localhost:5190` and follow the **Guided demo** card at the top of the dashboard:

| Step | Dashboard Action | Expected Outcome |
|---|---|---|
| **1. Set the money rules** | In **Owner mandate**, keep `$0.50`/item, `$2.00`/day, blocked vendor `ShadyData`, and click **Save to memory**. | A `RULE` memory event is recorded. |
| **2. First agent asks** | On **Research Agent**, run **Coffee market brief**. In **Owner inbox**: approve **OpenStats (`$0.20`)**; reject **DataHarbor (`$0.45`)** with *"Too expensive"* checked; reject **QuickFacts (`$0.10`)** with *"Flag vendor as bad"* checked. | OpenStats is paid via x402 and verified on the ledger/chain; verdicts, vendor flag, receipt, and chain status are written to memory. |
| **3. New session remembers** | Click **New session** on **Research Agent** (wiping in-RAM state, recalling from memory), then run **Weekly update**. | Zero prompts in Owner inbox: duplicate `os-coffee-exports` is skipped, trusted `OpenStats` (`$0.25`) is auto-bought, flagged `QuickFacts` is rejected, `DataHarbor` (`$0.48`) is blocked by the learned `$0.45` price ceiling, and `ShadyData` is blocked by mandate. |
| **4. Second agent obeys** | On **Shopping Agent**, run **Datasets for a dashboard**. | Without prior training, Shopping Agent recalls the shared memory: skips already-bought `os-rainfall-yield`, auto-buys `os-roaster-directory` (`$0.30`), rejects flagged `QuickFacts`, and blocks `$1.20` report over the `$0.50` per-item limit. |
| **5. Never trust the merchant** | Enable **Greedy merchant** (adds `$0.10` to HTTP 402 terms) and run **Shopping Agent → Price check** (`$0.15` catalog price). Optionally test **Fail next payment on-chain** (local ledger mode) followed by **Audit receipts**. | Greedy overcharge is refused *before* signing. On simulated on-chain failure, Mandate writes a `CORRECTION` memory so failed spend does not count against daily limits. |
| **6. Revoke delegate key** | Click **Revoke key** in **Delegate key** and try running any agent task. | Active sessions are cleared and agents show `ACCESS REVOKED` (`HTTP 403`). |


# Sui Testnet payment verification

Status: one controlled $0.08 USDC Testnet settlement is confirmed. The demo merchant returned
digest `7Lszdc8FS4pLY6EQN9hUxGxc7Q6pKZNiXLfu91BWshwn`; Tatum independently read it as
`success` in 193 ms. The full guided app demo has not been exercised on the Testnet rail.

## Access and request budget

Obtain approval before using Tatum/Walrus keys or submitting an on-chain transaction. Approval must
cover the actual step; permission for a Tatum probe alone does not authorize a deposit or payment.
Never paste `.env`, private keys or API keys into chat/output. Keep `PAYMENT_RAIL` on its current
setting until the first live payment is verified. Do not start a Walrus-mode server just to inspect
it: boot may retry outstanding writes using the delegate key.

| Step | Network effect |
|---|---|
| `npm test`, typecheck, build | Offline; no wallet, Tatum or Walrus calls |
| `wallet:testnet -- init` | Offline key creation; existing wallet reused |
| `wallet:testnet -- status` | 1 read-only public Sui Testnet GraphQL request; if it fails, 2 public fullnode gRPC reads; no Tatum quota |
| `wallet:testnet -- preview-deposit` | Public GraphQL reads and a simulation; no signature or transfer |
| `wallet:testnet -- deposit` | Public GraphQL reads + one signed Testnet transaction if coin objects exist; spends Testnet gas |
| `wallet:testnet -- verify-deposit <digest>` | Public GraphQL indexing wait + balance read; no signature or transfer |
| `spike:tatum-testnet` | 1 Tatum gateway request |
| `spike:x402-testnet` | One $0.08 Testnet USDC transfer; about 4–7 Tatum requests |
| `spike:tatum-testnet -- <digest>` | Read an existing Testnet payment; normally 1 Tatum request |
| `spike:revoke-check` | 1 Walrus request per invocation; separate from the payment check |

## 1. Fund a Testnet wallet

Generate or inspect your local Testnet wallet (stores `AGENT_WALLET_PRIVATE_KEY` in `.env` and prints only the public Sui address):

```bash
npm run wallet:testnet -w server -- init
```

Open Circle's USDC Faucet, select **USDC** on **Sui Testnet**, and send test tokens to your printed public Sui address. Never enter a private key in any faucet. (For reference, our verified Testnet spike used the public demo wallet `0xb9aa1344cf7c2de9b70d56cc7a3ec2285189729a687b98375fa99261100bd061`.)

After the faucet transfer and approval for public read calls:

```bash
npm run wallet:testnet -w server -- status
```

The script uses Sui's public Testnet GraphQL service first, with public fullnode gRPC as a fallback.
It prints SUI and USDC split between coin objects and address balance. x402 spends the
**USDC address balance**. If USDC is only in coin objects, preview the same-address deposit without signing:

```bash
npm run wallet:testnet -w server -- preview-deposit
```

After reviewing the preview and obtaining approval for one Testnet transaction, run:

```bash
npm run wallet:testnet -w server -- deposit
```

Expect a successful deposit digest and at least 0.08 USDC in the address balance. Ensure the wallet
also holds Testnet SUI for deposit gas (`npm run wallet:testnet -w server -- fund-sui` if needed),
and check the live balance rather than assuming prior state.
The public GraphQL balance query may briefly show the old coin object after a successful execution.
Do not send the deposit again. Recheck the existing digest and then read balances with:

```bash
npm run wallet:testnet -w server -- verify-deposit <existing-digest>
```

## 2. Probe Tatum once

Once the owner approves one Tatum request:

```bash
npm run spike:tatum-testnet -w server
```

`TATUM_TESTNET_API_KEY` takes precedence. If it is empty, the script tries `TATUM_API_KEY`; whether
that key is accepted for Testnet is determined by the gateway. Missing both fails locally before
any request. An unsuccessful probe exits nonzero. Resolve authentication before attempting payment.

## 3. Submit exactly one payment

With approval for one $0.08 Testnet USDC payment and approximately 4–7 Tatum requests:

```bash
npm run spike:x402-testnet -w server
```

The merchant returns HTTP 402; the agent checks the approved amount, known recipient and network,
signs offline, and the merchant settles through Tatum. The script then reads the digest independently
through Tatum. Record the digest, explorer URL and independent Tatum read result.
Do not claim a confirmed live payment from a successful signature or merchant response alone.

If a digest was printed but the independent read fails or returns “not found yet”, **do not run
the payment command again**. Obtain approval for a read, then use the existing digest:

```bash
npm run spike:tatum-testnet -w server -- <existing-digest>
```

If the failure happened before any digest was returned, inspect the error before deciding whether
a retry is safe. This script is a settlement spike, not a demonstration of Walrus memory reuse.

## 4. Enable the app only after verified evidence

After a successful live spike, the owner may choose `PAYMENT_RAIL=x402-testnet` in `.env` and restart
the API. The agents share the Testnet wallet. The UI must identify Sui Testnet and Tatum; the
“fail next transaction” control stays disabled for real-chain settlement. The greedy merchant
control still demonstrates refusing an amount above the approved price.

If a payment's independent chain read is unavailable, the application saves the digest with
status `unknown` and displays *Awaiting chain*. Its pending receipt still reserves daily spend and
blocks a duplicate. Use **Audit receipts** once the gateway is available (with permission for its
Tatum reads and any Walrus reads/writes in live memory mode). A successful audit confirms the
existing purchase without another payment.

## 5. Test live delegate revocation separately

Create a second, disposable delegate key in the owner's Walrus dashboard and save it privately as
`MEMWAL_TEST_PRIVATE_KEY`. Do not remove the main delegate key. With approval for each request:

```bash
npm run spike:revoke-check -w server
```

Record “accepted”, remove only that disposable key in the dashboard, then obtain approval and
run the command again. Record “rejected (401)”. Fake-client tests and in-app revoke controls are
not a replacement for this live evidence.

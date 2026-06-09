# CAW x402 Purchasing Skill for Agent Runtimes

Runnable MVP skeleton for a reusable purchasing skill that lets existing agent runtimes buy single-shot x402 paid resources through Cobo Agentic Wallet (CAW), with quote review, Pact-scoped authorization, duplicate-payment protection, delivery validation, and redacted audit evidence.

`GET /risk-report?address=...` is the Example Paid Resource used to prove the purchasing capability end to end. It is not the full project boundary. The core boundary is the agent-facing purchasing workflow: provider manifest, quote/precheck, provider status/recovery, CAW Pact authorization, paid retry or cache recovery, validation, and audit.

The target runtime is Codex, Claude Code, or another existing agent runtime reading the repo-local `caw-x402-purchasing` skill. The canonical skill source lives at `skills/caw-x402-purchasing/`; `.agents/skills/caw-x402-purchasing` can be a local runtime symlink to that source. The demo does not require building a new vertical agent app, marketplace, escrow system, reputation registry, real risk-data provider, or browser UI.

## Live Test Notes

- [2026-06-01 x402 + CAW Live Test 问题复盘](./docs/2026-06-01-live-test-issues.md)
- [2026-06-01 x402 + CAW Live Test Evidence](./docs/2026-06-01-live-test-evidence.md)
- [CAW x402 Operator Runbook](./docs/caw-x402-operator-runbook.md)

## Boundaries

- Purchasing Skill: repo-local agent instructions at `skills/caw-x402-purchasing/SKILL.md`, with `.agents/skills/caw-x402-purchasing` reserved as the local runtime install link. It tells an agent runtime how to read provider capabilities, enforce quote-first and precheck-first rules, prevent duplicate payment, invoke the skill-local scripts safely, and redact sensitive CAW/payment material.
- Provider Server: Hono API exposing the Example Paid Resource at `GET /risk-report?address=...`, plus agent-facing discovery and recovery helpers: `GET /llms.txt` and `GET /orders/status?fingerprint=...` / `GET /orders/status?paymentId=...`.
- Skill-local purchase CLI: `skills/caw-x402-purchasing/scripts/purchase-with-caw-fetch.mjs`. It reads the 402 requirement, checks price/payee/network/token/resource, submits a CAW Pact request for end-to-end purchases, waits for Cobo Wallet approval, executes `caw fetch`, and emits a redacted result summary.
- CAW Pact: task-level authorization. Human approval of the Pact authorizes later execution within strict policy bounds. It is not the same UX as a wallet popup for every transaction. Use `always_review` in future versions if every operation should require owner review.
- x402 settlement proves payment. Report validation proves service delivery quality for this MVP. Both are recorded because one does not replace the other.
- Safety rule: quote mismatch, payee mismatch, token mismatch, network mismatch, or changed paid resource must fail closed. Do not perform real CAW payment or live settlement unless the operator explicitly approves it.

## Setup

```bash
npm run install:all
npm run check
npm run test
```

Copy `.env.example` to `.env` locally if you use env loading in your shell. Do not commit `.env`.

Important values:

- `PROVIDER_PAY_TO_ADDRESS`: provider receiving address. The default is the Phantom Solana Devnet seller address used by the current demo.
- `X402_NETWORK`, `X402_TOKEN_SYMBOL`, `X402_PRICE_USDC`: quoted payment requirement. The default network is Solana Devnet; supported Provider schemes are EVM `eip155:*` and Solana `solana:*`.
- `X402_ASSET_ADDRESS`: optional token contract or mint address for explicit x402 quotes when the network has no default asset or the default asset is not supported by the buyer wallet.
- `X402_FACILITATOR_URL`: x402 facilitator endpoint.
- `CAW_API_BASE_URL`, `CAW_AGENT_CREDENTIAL`: real CAW CLI/API access. Keep secret.

## Run Provider

```bash
npm run backend:provider
```

Agent-facing provider capability manifest:

```bash
curl -s http://localhost:4021/llms.txt
```

Unpaid quote check:

```bash
curl -i \
  -H 'Accept: application/json' \
  'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001'
```

Expected:

- HTTP `402 Payment Required`
- `PAYMENT-REQUIRED` header
- JSON `{ "error": "payment_required", ... }`
- SQLite runtime state under `data/`
- no report body before payment

Invalid address check:

```bash
curl -i 'http://localhost:4021/risk-report?address=not-an-address'
```

Expected: HTTP `400`.

Order status / duplicate-payment guard checks:

```bash
curl -s 'http://localhost:4021/orders/status?fingerprint=<requestFingerprint>'
curl -s 'http://localhost:4021/orders/status?paymentId=<paymentId>'
```

Expected status responses never include CAW credentials, pact-scoped API keys, raw payment payloads, private keys, seed phrases, or replayable payment proofs. If status is `paid` or `delivered`, the agent should recover delivery or use cached delivery instead of paying again.

Default Solana Devnet configuration:

```bash
PROVIDER_PAY_TO_ADDRESS=Fxvz4gTxj2NMECVDD4XM3d5BGfMSv2mViyh4JFHh6oKk \
X402_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 \
X402_TOKEN_SYMBOL=USDC \
X402_PRICE_USDC=0.005 \
npm run backend:provider
```

These are the built-in defaults for `npm run provider`. The default x402 Solana Devnet asset is USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, which matches Cobo CAW token `SOLDEV_SOL_USDC`.

## Agent Runtime Flow

Codex, Claude Code, or another agent runtime should use the repo-local `caw-x402-purchasing` skill as both the policy layer and the execution entrypoint:

1. Read `GET /llms.txt` for provider capabilities.
2. Run the skill-local precheck to fetch and validate the x402 quote.
3. Query `/orders/status` by request fingerprint before Pact submission.
4. Present quote, provider status, Purchase Intent, and Pact summary.
5. For end-to-end purchase requests, run the skill-local purchase script with `--execute`; it submits the CAW Pact request and waits for Cobo Wallet approval.
6. Validate the returned risk report and write redacted audit evidence.

## Run Skill-Local Purchase Script

Precheck only:

```bash
npm run skill:purchase -- \
  --url 'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001' \
  --max-price-usdc 0.005 \
  --expected-payee <allowed_payee> \
  --expected-token USDC \
  --expected-network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
```

The skill script translates x402 network/token identifiers into CAW policy identifiers for the Pact. For Solana Devnet USDC that means x402 `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` + `USDC` becomes CAW `SOLDEV_SOL` + `SOLDEV_SOL_USDC`.

Full flow:

```bash
npm run skill:purchase -- \
  --url 'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001' \
  --max-price-usdc 0.005 \
  --expected-payee <allowed_payee> \
  --expected-token USDC \
  --expected-network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 \
  --execute
```

The full flow submits a Pact request and waits for Cobo Wallet approval. If the Pact is denied, times out, or `caw fetch` fails, the CLI stops safely and reports redacted evidence. It must not loop payment attempts.

## Failure Checks

- Address format rejection: call Provider with `address=not-an-address`; expect `400`.
- Over-budget refusal: run the skill-local purchase script with `--max-price-usdc 0.001`; expect no Pact/payment and a failure reason.
- Payee mismatch refusal: use a different `--expected-payee`; expect no payment.
- Token/network mismatch refusal: use mismatched `--expected-token` or `--expected-network`; expect no payment.
- CAW policy denial: approve a narrower Pact than the required payment or reuse a completed Pact; expect safe failure and no paid retry loop.
- Successful payment and delivery: configure CAW plus x402 payment proof adapter; expect paid retry `200`, `PAYMENT-RESPONSE`, validated report, and final audit.
- Cached retry: retry the same payment id/proof; Provider should return cached delivery without another settlement.
- Conflict behavior: reuse the same payment id for a different address; Provider should return `409`.

## Generated Files

- `data/`: local SQLite files. Ignored by git.
- `audits/`: local audit JSON. Ignored by git.

Never commit CAW credentials, pact-scoped API keys, wallet private keys, seed phrases, raw secret-bearing Pact payloads, generated SQLite databases, or private audit records.

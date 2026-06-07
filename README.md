# CAW x402 Agent Commerce

[中文 README](./README.zh-CN.md)

Reusable agent-commerce toolkit for buying x402 paid resources through Cobo Agentic Wallet.

The project shows how an existing agent runtime such as Codex or Claude Code can inspect an x402 payment requirement, apply user constraints, request a CAW Pact, execute a scoped payment, recover delivery safely, validate the result, and write redacted audit evidence.

## What It Is

`caw-x402-agent-commerce` is not a standalone vertical agent app. It is a hackathon-ready reference project for agentic commerce:

- `backend/`: seller-side x402 paid-resource provider.
- `agents/`: buyer-side agent executor for quote review, CAW Pact planning, payment execution, delivery validation, and audit output.
- `skills/`: reusable agent runtime skill instructions.
- `examples/risk-report/`: the example paid resource used to prove the flow.
- `docs/`: architecture, design context, operator notes, and live-test evidence.
- `frontend/`: lightweight browser demo console served by the provider at `/demo`.

The current example paid resource is `GET /risk-report?address=...`. It exists to demonstrate the commerce flow; the reusable project boundary is the purchasing capability.

## Architecture

```text
User / Operator
  -> Agent Runtime
  -> skills/caw-x402-purchasing
  -> agents buyer executor
  -> backend x402 paid-resource provider
  -> x402 Facilitator
  -> CAW Pact-scoped wallet action
  -> delivery validation + redacted audit
```

## Quick Start

Install dependencies:

```bash
npm run install:all
```

Run checks:

```bash
npm run check
npm run test
```

Start the provider:

```bash
npm run backend:provider
```

Open the browser demo console:

```text
http://localhost:4021/demo
```

The console is for operator/reader visibility. It shows provider capability, quote, status, and Pact-plan shape for the demo provider, and it generates a copyable purchase-intent prompt. The prompt follows a task/spend-plan/wallet-authorization/safety-boundary shape and points the agent to `skills/caw-x402-purchasing`; the skill owns the concrete workflow. The console does not call Codex directly or execute payments from the browser.

In another terminal, run quote/precheck only:

```bash
npm run agents:precheck -- \
  --address 0x0000000000000000000000000000000000000001 \
  --api http://localhost:4021/risk-report \
  --max-price-usdc 0.005
```

Do not run a live payment flow unless the operator explicitly approves it in the current session.

## Demo Flow

1. Start `backend/`.
2. Open `http://localhost:4021/demo` for the browser demo console.
3. Use the page to inspect the example provider's manifest, quote, status, and Pact-plan shape.
4. Copy the generated purchase-intent prompt into Codex, Claude Code, or another runtime that has the skill installed.
5. The agent runtime reads `skills/caw-x402-purchasing` and lets the skill drive quote review, status recovery, Pact planning, payment, delivery validation, and redacted audit evidence.
6. Payment execution still requires explicit operator approval in the agent runtime session.

## Safety Rules

- Quote first, pay later.
- Fail closed on amount, token, network, payee, method, or resource mismatch.
- Query provider status before submitting a new Pact.
- Prefer recovery when payment or delivery evidence already exists.
- Never persist CAW credentials, pact-scoped API keys, raw payment payloads, private keys, seed phrases, or reusable payment proofs.

## Docs

- [Architecture](./docs/architecture.md)
- [Context](./docs/CONTEXT.md)
- [Implementation plan](./docs/design/caw-x402-agent-commerce-implementation-plan.md)
- [Operator runbook](./docs/operator-runbook.md)
- [Live-test evidence](./docs/live-test-evidence.md)

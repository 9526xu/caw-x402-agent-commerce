# Hackathon Project Brief

Status: runnable prototype; final demo video and refreshed live-payment evidence pending.

`caw-x402-agent-commerce` is an Agent-Native Payments infrastructure project for Cobo Agentic Wallet. It gives existing agent runtimes such as Codex or Claude Code a safe way to buy x402 paid resources with CAW-controlled funds.

The project is not a standalone vertical agent app. The core contribution is a reusable purchasing capability: an agent can inspect a paid resource, review the x402 quote, check provider recovery status, request a least-privilege CAW Pact, execute a scoped payment, validate delivery, and write redacted audit evidence.

## Track

- Primary: Cobo Agentic Commerce / Agent-Native Payments.
- Secondary: Agent Resource Procurement infrastructure.
- Supporting themes: AI security, wallet permissioning, auditable agent operations.

The project fits the track because the agent performs a real funding workflow: task request -> paid-resource quote -> CAW authorization -> x402 payment -> delivery -> audit. CAW is the wallet and policy boundary for the funds, not a decorative integration.

## Problem

Agents can already browse, reason, call tools, and execute code, but they are still weak payment citizens on the internet.

When an agent encounters a machine-readable paid resource, several things are missing:

- It needs to understand HTTP 402 / x402 payment requirements.
- It must compare amount, token, network, payee, method, and resource against the user's constraints.
- It needs wallet access that is scoped to the task, not broad access to a user's funds.
- It must avoid duplicate payment when delivery fails, a retry is ambiguous, or prior CAW/chain/provider evidence already exists.
- It should leave an audit trail that is useful without leaking wallet credentials or reusable payment proofs.

This project fills that gap for single-shot x402 paid resources.

## User

- Agent operators who want an existing runtime to safely buy data, APIs, reports, or compute.
- Developers building agentic commerce tools who need a reference CAW + x402 payment flow.
- Hackathon judges evaluating whether an agent can participate in economic activity with real wallet controls.

The MVP assumes the user supplies a concrete paid resource URL and spending constraints. It intentionally does not implement open-ended search, multi-provider price discovery, autonomous trading, escrow, or A2A markets.

## Proposed Solution

A reusable CAW-backed x402 purchasing toolkit:

- `skills/caw-x402-purchasing/`: agent-runtime instructions and deterministic helper scripts.
- `agents/`: buyer-side executor for quote review, CAW Pact planning, payment execution, delivery validation, and audit output.
- `backend/`: seller-side x402 paid-resource provider with `/risk-report`, `/llms.txt`, and `/orders/status`.
- `frontend/`: lightweight demo console served at `/demo` for visibility and a copyable purchase-intent prompt.

The example paid resource is `GET /risk-report?address=...`. It proves the flow end to end, but the product boundary is the purchasing capability rather than the risk-report service.

Core safety behavior:

- Quote first, pay later.
- Fail closed on amount, token, network, payee, method, or resource mismatch.
- Query provider status before wallet authorization or payment.
- Prefer recovery when a provider, CAW, chain, or local audit record shows prior payment or delivery evidence.
- Keep CAW credentials, pact-scoped API keys, raw payment payloads, private keys, seed phrases, and reusable payment proofs out of logs and audit files.

## AI x Web3 Bridge

- Agent capability: interpret a user purchase intent, inspect an x402 paid resource, enforce payment policy, choose whether to proceed, recover delivery, validate the result, and summarize evidence.
- Web3 primitive: CAW wallet account, CAW Pact-scoped authorization, x402 payment requirement, x402 facilitator verification/settlement, and testnet transaction evidence.
- Human-in-the-loop point: the agent shows quote, provider status, and least-privilege Pact summary before wallet authorization. For end-to-end purchase requests, it submits the Pact request and the operator approves the funds boundary in Cobo Wallet.
- Verification or audit trail: provider order status, request fingerprint, payment id when available, CAW transaction reference, chain transaction hash/signature, delivery hash, validation result, and redacted audit JSON.

Why CAW is critical:

- CAW holds and controls the agent funds.
- CAW Pact policy narrows what the agent can do: chain, token, destination, amount, transaction count, and time window.
- CAW lets the agent execute a wallet action after approval without receiving unrestricted wallet access.
- CAW transaction records and policy evaluation help distinguish payment failure from delivery failure, which prevents blind duplicate payments.

## Demo Path

1. Start the local provider with `npm run backend:provider`.
2. Open `http://localhost:4021/demo` to inspect provider health, `/llms.txt`, quote, status, Pact-plan shape, and generated purchase-intent prompt.
3. In an agent runtime, use `skills/caw-x402-purchasing` with a concrete paid resource URL and budget.
4. Run quote/precheck only:

   ```bash
   npm run skill:precheck -- \
     --url 'http://localhost:4021/risk-report?address=0x0000000000000000000000000000000000000001' \
     --max-price-usdc 0.005
   ```

5. Show the quote, provider status, purchase intent, and CAW Pact summary.
6. Submit the CAW Pact request, then have the operator approve the funds boundary in Cobo Wallet.
7. Use the approved Pact to execute x402 payment, recover delivery, validate the result, and write redacted audit evidence.
8. Demonstrate one safety case, such as over-budget refusal, payee mismatch refusal, or delivered-order recovery without duplicate payment.

Current automated verification:

```bash
npm run check
npm run test
```

## Risks

- Live wallet demos can fail for external reasons: facilitator availability, RPC behavior, testnet token-account readiness, or CAW policy state.
- x402 paid retries can be ambiguous: a CLI may fail after funds moved but before delivery completed. The project handles this by checking provider status, CAW tx evidence, and local audit state before retrying.
- Raw payment payloads, pact-scoped API keys, and reusable payment proofs must never be pasted into public docs, demo logs, or audit artifacts.
- The MVP is intentionally narrow. It supports single-shot fixed-price JSON resources, not subscriptions, dynamic pricing, refunds, escrow, autonomous trading, or open-ended resource discovery.

## Next Step

1. Refresh live-payment evidence from this standalone repo using the current Solana Devnet seller payee, then record the CAW wallet address, provider payee, transaction hash, order id, and audit path.
2. Add a submission/demo guide that links this brief, README, live evidence, and the 3-5 minute video script.
3. Record the demo video around three moments: agent reads the purchasing skill, CAW Pact-scoped payment executes, and the audit/recovery guard proves the safety boundary.
4. Clarify the local runtime install path for `skills/caw-x402-purchasing` so judges can see how Codex or Claude Code consumes the skill.

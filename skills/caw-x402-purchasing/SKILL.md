---
name: caw-x402-purchasing
description: Use when an agent runtime needs to buy a single-shot x402 paid resource through wallet adapters such as Cobo Agentic Wallet or FluxA x402 v3, with quote review, provider status recovery, duplicate-payment protection, redacted audit evidence, and strict fail-closed payment constraints.
---

# x402 Purchasing With Wallet Adapters

Use this skill when a user asks Codex, Claude Code, or another agent runtime to purchase an x402 paid resource. CAW Pact is the default wallet adapter; FluxA x402 v3 intent mandate is a reference adapter. The `backend/` provider is the Example Paid Resource, and `agents/` is a demo harness rather than a runtime dependency for this skill.

Do not perform live wallet payment, Pact creation, mandate creation, or paid retry unless the user explicitly approves it in the current conversation. Default to fake facilitator or local precheck/test paths.

## User Intent Input

Prefer a short purchase-intent prompt over a hard-coded runbook. A good invocation gives the agent:

- The task to complete.
- The paid resource URL or provider manifest.
- The spend plan: budget, token/currency, task scope, and desired authorization window.
- The wallet authorization model: use CAW Pact approval, not raw wallet access.
- The approval boundary: show quote/status/Pact summary and stop before Pact creation or payment.

The prompt should not restate every quote, status, payment, recovery, validation, and audit step. Those rules live in this skill.

## Workflow

State machine:

```text
requested
-> manifest_checked
-> quoted
-> provider_status_checked
-> intent_planned
-> authorization_planned
-> authorization_approved
-> payment_executed
-> delivered / delivery_recovered
-> validated
-> audited
```

Failure branches:

```text
quote_mismatch -> stopped
already_paid -> recovery
already_delivered -> delivered_from_cache
payment_failed -> audit_failed
delivery_failed -> manual_review
conflict -> manual_review
```

## Required Order

1. Read the provider manifest first when available: `GET /llms.txt`.
2. Run quote/precheck before wallet authorization or payment.
3. Query provider status before wallet authorization:
   - `GET /orders/status?fingerprint=<requestFingerprint>`
   - `GET /orders/status?paymentId=<x402PaymentIdentifier>` when the x402 payment identifier is available.
4. Build a Purchase Intent from user constraints, provider manifest, quote, and status.
5. Show the quote and wallet-authorization summary before any live wallet call.
6. Execute payment only after quote, policy, provider status, and wallet authorization all pass.
7. Validate delivery and write a redacted audit record.

## Wallet Adapter Rules

Skill scripts must remain self-contained under `skills/caw-x402-purchasing/scripts/`. Do not import from this repo's `agents/src` or `backend/src`.

Supported planning adapters:

- `caw`: plans a CAW Pact authorization summary and stops for user approval.
- `fluxa-x402v3`: plans a signed intent mandate flow and stops before calling the FluxA mandate or payment endpoints.

The generic flow is: paid resource -> quote/payment requirement -> spend intent -> authorization object -> user approval -> x402 payment header -> paid retry -> result or structured failure -> redacted audit.

## Provider Manifest Rules

The manifest should describe paid resources, quote/status/recovery capabilities, payment constraints, and safety rules. Treat a paid resource as unsupported if its path, method, content type, token, network, payee, or recovery behavior conflicts with the manifest or user constraints.

For this repo's demo provider:

- Manifest: `GET /llms.txt`
- Quote: `GET /risk-report?address={evm_address}` without payment; read `X-Request-Fingerprint` from the 402 response.
- Status: `GET /orders/status?fingerprint={requestFingerprint}`
- Payment status: `GET /orders/status?paymentId={x402PaymentIdentifier}`
- Paid retry / delivery: `GET /risk-report?address={evm_address}` with payment proof

`paymentId` means the provider-visible x402 payment identifier extension. A CAW tx record id is payment evidence, but it is not a Provider `paymentId` unless the provider explicitly maps it.

For Solana quotes, the payee must have a token account for the quoted asset/mint. If the precheck reports missing recipient readiness, stop before Pact creation because Facilitator verify can fail with `transaction_simulation_failed` / `InvalidAccountData`.

## Quote And Precheck Rules

Fail closed before payment if any quoted field differs from the user constraints:

- amount exceeds budget
- token mismatch
- network mismatch
- payee mismatch
- Solana payee has no token account for the quoted asset
- resource or method mismatch
- manifest does not list the paid resource
- quote changes after Pact planning

If the quote changes, restart with a fresh Purchase Intent and fresh CAW Pact approval.

## Order Status And Recovery Rules

Provider order status is authoritative for provider-side recovery decisions, but the agent must still apply its own policy checks.

- `not_found`: run quote/precheck; do not submit Pact until quote passes.
- `payment_required`: continue only after quote and policy checks pass.
- `paid`: recover delivery or retry paid request; do not pay again.
- `delivered`: use cached delivery or recovered result; do not pay again.
- `conflict`, `delivery_failed`, `expired`: stop for review unless the user explicitly asks for a fresh quote.

## Duplicate Payment Guard

Check all available evidence before new wallet authorization or payment:

- Provider order/status result.
- Agent-side audit/state from prior attempts.
- CAW Pact status, CAW tx status, request id, payment id, and recent tx evidence.
- Chain transaction hash/signature if already available.

Rules:

- Already delivered: recover/cache, no new payment.
- Already paid but not delivered: recovery first, no new payment.
- Existing Pact submitted or approved: continue original flow, do not submit a duplicate Pact.
- Same payment id with different purchase fingerprint: conflict and manual review.
- Missing local state but CAW/chain shows payment: record evidence summary, stop new payment, recover provider delivery.

If `caw fetch` exits non-zero or prints `{}`, do not infer that no payment happened. Check CAW Pact progress, recent tx records, and provider status before any retry. Treat "CAW tx succeeded but provider still returns 402" as `delivery_failed` / manual review until provider logs prove a recoverable paid order.

## Redaction Rules

Never print, persist, or include in audit output:

- CAW credential.
- pact-scoped API key.
- raw payment payload.
- private key or seed phrase.
- replayable payment proof.

Allowed audit summaries include payment id, Pact id, redacted credential availability, provider order id, request fingerprint, quote summary, CAW tx reference, chain transaction hash/signature, delivery hash, validation result, and stop reason.

## Bundled Resources

- `scripts/check-provider-capabilities.mjs`: read `/llms.txt` and optional `/orders/status` into a redacted JSON summary.
- `scripts/run-purchase-precheck.mjs`: read manifest, quote, `X-Request-Fingerprint`, provider status, and policy checks into one redacted JSON summary.
- `scripts/authorize.mjs`: run precheck and build a redacted wallet-adapter authorization plan without creating a Pact, mandate, payment, or proof.
- `scripts/lib/`: shared quote, status, policy, authorization, error, and adapter modules for portable skill CLIs.
- `templates/audit-record.example.json`: copy this shape when writing an agent-side audit summary.
- `references/provider-capability-contract.md`: load when implementing or reviewing provider manifest/status behavior.

## Invocation Templates

Run consumer templates from this repo root.

Manifest / quote / status precheck, no payment:

```bash
npm run skill:precheck -- \
  --url 'http://localhost:4021/risk-report?address=<target_address>' \
  --max-price-usdc <budget> \
  --expected-payee <allowed_payee> \
  --expected-token USDC \
  --expected-network <allowed_network>
```

Authorization plan only, no Pact/mandate/payment:

```bash
npm run skill:authorize -- \
  --url 'http://localhost:4021/risk-report?address=<target_address>' \
  --max-price-usdc <budget> \
  --wallet-adapter caw \
  --expected-payee <allowed_payee> \
  --expected-token USDC \
  --expected-network <allowed_network>
```

FluxA x402 v3 authorization plan only, no mandate/payment:

```bash
npm run skill:authorize -- \
  --url 'https://fluxa-x402-api.gmlgtm.workers.dev/polymarket_recommendations_last_1h' \
  --max-price-usdc <budget> \
  --wallet-adapter fluxa-x402v3
```

Precheck / quote review only:

```bash
npm run agents:precheck -- \
  --address <target_address> \
  --api <paid_resource_api> \
  --max-price-usdc <budget> \
  --expected-payee <allowed_payee> \
  --expected-token USDC \
  --expected-network <allowed_network>
```

Full payment flow, only after explicit user approval for live payment:

```bash
npm run agents:consumer -- \
  --address <target_address> \
  --api <paid_resource_api> \
  --max-price-usdc <budget> \
  --expected-payee <allowed_payee> \
  --expected-token USDC \
  --expected-network <allowed_network>
```

Provider manifest/status checks:

```bash
curl -s http://localhost:4021/llms.txt
curl -s 'http://localhost:4021/orders/status?fingerprint=<requestFingerprint>'
curl -s 'http://localhost:4021/orders/status?paymentId=<paymentId>'
```

Run bundled helper templates from the repo root.

```bash
node skills/caw-x402-purchasing/scripts/check-provider-capabilities.mjs \
  --base-url http://localhost:4021 \
  --fingerprint <requestFingerprint>
```

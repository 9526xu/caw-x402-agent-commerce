---
name: caw-x402-purchasing
description: Use when an agent runtime needs to buy a single-shot x402 paid resource through wallet adapters such as Cobo Agentic Wallet or FluxA x402 v3, with quote review, provider status recovery, duplicate-payment protection, redacted audit evidence, and strict fail-closed payment constraints.
---

# x402 Purchasing With Wallet Adapters

Use this skill when a user asks Codex, Claude Code, or another agent runtime to purchase an x402 paid resource. CAW Pact is the default wallet adapter; FluxA x402 v3 intent mandate is a reference adapter. The `backend/` provider is the Example Paid Resource, and `agents/` is a demo harness rather than a runtime dependency for this skill.

Use the installed skill's own `scripts/` directory as the execution entrypoint. Do not search for package roots, consumer scripts, or `agents/` directories to execute a purchase unless the user explicitly asks to inspect the demo harness.

In a source checkout that has `package.json`, `npm run skill:*` commands are convenient wrappers. In a buyer runtime workspace such as Claude Code's `.claude/skills/caw-x402-purchasing` install, run the scripts directly:

```bash
node .claude/skills/caw-x402-purchasing/scripts/run-purchase-precheck.mjs ...
node .claude/skills/caw-x402-purchasing/scripts/authorize.mjs ...
node .claude/skills/caw-x402-purchasing/scripts/purchase-with-caw-fetch.mjs ...
```

If `.claude/skills/caw-x402-purchasing` does not exist but `.agents/skills/caw-x402-purchasing` does, use the same paths under `.agents/skills/caw-x402-purchasing`. Do not use `find` to discover older project copies.

Default to fake facilitator or local precheck/test paths unless the user has asked for an end-to-end purchase. If the user only asks for quote, precheck, planning, or authorization preview, do not submit a Pact or execute payment.

Approval model:

- If the user has given an end-to-end purchase intent plus budget and provider constraints, the agent must submit a CAW Pact request after manifest, quote, provider status, and policy checks pass. Do not ask for an extra chat confirmation before Pact submission.
- Before submitting the Pact request, print or summarize the exact boundary being requested: chain, token, payee, amount, transaction count, and time window. This is an audit/update step, not a permission prompt.
- After submitting the Pact request, tell the user to approve the Pact in Cobo Wallet.
- Cobo Wallet approval is the funds authorization.
- Do not conflate Pact submission with payment execution. `--submit-pact` requests wallet authorization only; it does not pay. `--pay --pact-id <id>` executes payment with an approved Pact. `--execute` is an explicit all-in-one shortcut that submits a Pact, waits for approval, and pays.
- After a CAW Pact is active, the quote/status/policy still match, and no duplicate-payment evidence exists, execute the payment under that active Pact when the task is still an end-to-end purchase. Do not ask for another chat approval.
- Ask again only if the quote, payee, network, token, amount, resource, provider status, or Pact policy changes, or if recovery/manual review evidence appears.

## User Intent Input

Prefer a short purchase-intent prompt over a hard-coded runbook. A good invocation gives the agent:

- The task to complete.
- The paid resource URL or provider manifest.
- The spend plan: budget, token/currency, task scope, and desired authorization window.
- The wallet authorization model: use CAW Pact approval, not raw wallet access.
- The approval boundary: after quote/status/policy checks pass, submit the Pact request and prompt the user to approve the shown Pact in Cobo Wallet. Payment execution is a separate step using the approved Pact.

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
5. Print the quote and wallet-authorization summary as an audit/update step.
6. If the user asked for an end-to-end purchase, immediately submit the CAW Pact request after checks pass, then tell the user to approve it in Cobo Wallet. If the user asked only for planning or precheck, stop here.
7. Execute payment with `--pay --pact-id <approved-pact-id>` after quote, policy, provider status, and wallet authorization all pass; do not ask for another chat approval if the active Pact exactly matches the shown summary.
8. Validate delivery and write a redacted audit record.

## Wallet Adapter Rules

Skill scripts must remain self-contained under `skills/caw-x402-purchasing/scripts/`. Do not import from this repo's `agents/src` or `backend/src`.

Supported planning adapters:

- `caw`: plans a CAW Pact authorization summary. For end-to-end purchase requests, submit the Pact request after checks pass and prompt the user to approve it in Cobo Wallet. Cobo Wallet approval is the authoritative funds approval; once the Pact is active, pay with the approved Pact if the quote/status/policy still match.
- `fluxa-x402v3`: plans a signed intent mandate flow and stops before calling the FluxA mandate or payment endpoints.

The generic flow is: paid resource -> quote/payment requirement -> spend intent -> authorization object -> submit wallet authorization request -> wallet approval -> pay with approved Pact -> paid retry -> result or structured failure -> redacted audit.

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
- `scripts/purchase-with-caw-fetch.mjs`: run precheck and plan, submit a CAW Pact request with `--submit-pact`, pay with an approved Pact using `--pay --pact-id <id>`, or run the all-in-one submit/wait/pay shortcut with `--execute`.
- `scripts/lib/`: shared quote, status, policy, authorization, error, and adapter modules for portable skill CLIs.
- `templates/audit-record.example.json`: copy this shape when writing an agent-side audit summary.
- `references/provider-capability-contract.md`: load when implementing or reviewing provider manifest/status behavior.

## Invocation Templates

Run skill templates from the installed skill directory. Prefer these skill-local scripts over any repo-level `agents/` demo harness.

If you are in a source checkout with `package.json`, you may use the `npm run skill:*` wrappers shown below. If you are in a buyer workspace without `package.json`, replace `npm run skill:precheck --` with `node .claude/skills/caw-x402-purchasing/scripts/run-purchase-precheck.mjs`, replace `npm run skill:authorize --` with `node .claude/skills/caw-x402-purchasing/scripts/authorize.mjs`, and replace `npm run skill:purchase --` with `node .claude/skills/caw-x402-purchasing/scripts/purchase-with-caw-fetch.mjs`.

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

End-to-end CAW purchase through the skill-local script:

```bash
npm run skill:purchase -- \
  --url 'http://localhost:4021/risk-report?address=<target_address>' \
  --max-price-usdc <budget> \
  --expected-payee <allowed_payee> \
  --expected-token USDC \
  --expected-network <allowed_network>
```

The command above plans only. For an end-to-end purchase request, first submit the CAW Pact request:

```bash
npm run skill:purchase -- \
  --url 'http://localhost:4021/risk-report?address=<target_address>' \
  --max-price-usdc <budget> \
  --expected-payee <allowed_payee> \
  --expected-token USDC \
  --expected-network <allowed_network> \
  --submit-pact
```

After the operator approves the Pact in Cobo Wallet, resume payment with the approved Pact id:

```bash
npm run skill:purchase -- \
  --url 'http://localhost:4021/risk-report?address=<target_address>' \
  --max-price-usdc <budget> \
  --expected-payee <allowed_payee> \
  --expected-token USDC \
  --expected-network <allowed_network> \
  --pay \
  --pact-id <approved_pact_id>
```

Only use the all-in-one shortcut when the operator explicitly wants the script to submit the Pact, wait for Cobo Wallet approval, and pay in one long-running command:

```bash
npm run skill:purchase -- \
  --url 'http://localhost:4021/risk-report?address=<target_address>' \
  --max-price-usdc <budget> \
  --expected-payee <allowed_payee> \
  --expected-token USDC \
  --expected-network <allowed_network> \
  --execute
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

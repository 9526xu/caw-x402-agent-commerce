# Provider Capability Contract

This reference captures the minimal provider-facing contract expected by the `caw-x402-purchasing` skill.

## Manifest

`GET /llms.txt` should return text that lets an agent identify:

- paid resource path and method
- content type and purchase type
- quote path
- status query path
- paid retry or delivery path
- recovery rule
- amount, token, network, and payee constraints

The manifest is advisory discovery. The agent must still compare the live x402 quote against user constraints.

## Quote

`GET /risk-report?address=<evm_address>` without payment should return `402 Payment Required`, a `PAYMENT-REQUIRED` header, and an `X-Request-Fingerprint` header.

The fingerprint is the Provider's canonical id for the purchase intent. Agents should use it for `/orders/status?fingerprint=...` instead of deriving or guessing fingerprint variants.

## Status

`GET /orders/status?fingerprint=<requestFingerprint>` is for pre-Pact duplicate-payment checks.

`GET /orders/status?paymentId=<x402PaymentIdentifier>` is for paid retry and recovery after the provider-visible x402 payment identifier exists.

A CAW tx record id is not a Provider `paymentId` unless the Provider explicitly maps it. Agents may record CAW tx ids as payment evidence, but should not expect `/orders/status?paymentId=<cawTxId>` to recover provider delivery.

Expected response shape:

```json
{
  "status": "not_found | payment_required | paid | delivered | conflict | expired | delivery_failed",
  "orderId": "rro_...",
  "paymentId": "pay_...",
  "requestFingerprint": "sha256:...",
  "resource": "/risk-report",
  "payment": {
    "amount": "0.005",
    "token": "USDC",
    "network": "solana:...",
    "payee": "Fxvz..."
  },
  "settlement": {
    "txId": "0xabc...",
    "tx_id": "0xabc...",
    "txHash": "0xabc...",
    "payer": "0x0000...00aa",
    "settledAt": "2026-06-09T..."
  },
  "delivery": {
    "available": true,
    "hash": "sha256:...",
    "recovery": "cached_delivery"
  },
  "agentAdvice": {
    "nextAction": "quote | submit_pact | recover | use_cached_delivery | stop_for_review",
    "reason": "Already delivered; do not pay again."
  }
}
```

## Agent Decisions

- `not_found`: quote/precheck before any Pact.
- `payment_required`: continue only after quote and policy checks pass.
- `paid`: recover; do not pay again.
- `delivered`: use cached delivery; do not pay again.
- `conflict`, `expired`, `delivery_failed`: stop for review unless the user explicitly requests a fresh quote.
- CAW tx succeeded but Provider status is still `not_found` or `payment_required`: stop for manual review, write redacted evidence, and inspect paid retry / verify / settle logs before any new payment.

## Redaction

Provider status and audit records must not include CAW credentials, pact-scoped API keys, raw payment payloads, private keys, seed phrases, or replayable payment proofs.

# Architecture

`caw-x402-agent-commerce` separates the reusable purchasing capability from the example paid resource.

## Modules

```text
frontend/
  optional demo surface

backend/
  x402 paid-resource provider
  /risk-report
  /llms.txt
  /orders/status

agents/
  buyer-side executor
  quote/precheck
  CAW Pact flow
  paid retry / recovery
  report validation
  audit record

skills/
  agent-runtime instructions
  deterministic helper scripts
  audit templates

docs/
  design context
  live-test evidence
  operator notes
```

## Runtime Flow

```text
requested
-> manifest_checked
-> quoted
-> provider_status_checked
-> intent_planned
-> pact_submitted
-> pact_approved
-> payment_executed
-> delivered / delivery_recovered
-> validated
-> audited
```

The provider handles seller-side order, payment, settlement, delivery, and recovery state. The agent executor handles buyer-side policy, quote review, CAW authorization, duplicate-payment checks, delivery validation, and redacted audit output.

## Boundaries

- The reusable capability is agentic purchasing for x402 resources.
- The risk report is an example paid resource.
- CAW Pact approval is the authorization boundary.
- x402 settlement proves payment.
- Delivery validation proves the service result is usable for this scenario.

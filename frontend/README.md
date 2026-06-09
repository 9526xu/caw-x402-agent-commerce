# Demo Console

`demo.html` is a lightweight browser console served by the provider:

```text
http://localhost:4021/demo
```

It displays provider health, `/llms.txt`, the x402 quote, provider order status, a CAW Pact summary, the audit-oriented timeline, and a copyable purchase-intent prompt.

The console does not execute live CAW payments and does not call Codex directly. The core product is still the reusable purchasing capability for existing agent runtimes, and funds authorization remains inside Cobo Wallet Pact approval.

The generated prompt intentionally avoids restating the full purchase workflow. It follows a task/spend-plan/wallet-authorization/safety-boundary shape: resource URL, budget, CAW Pact authorization model, and approval constraints. `skills/caw-x402-purchasing` drives the concrete quote, status, Pact, payment, recovery, validation, and audit steps.

Do not paste wallet-specific payment endpoints from another wallet playground into this prompt. FluxA-style intent mandates map conceptually to CAW Pacts here, but the payment implementation is this repo's CAW/x402 skill and executor.

A future Codex/agent SDK adapter should live behind a backend endpoint, not directly in browser JavaScript. That adapter must preserve the same authorization boundary: quote and Pact summary first, Cobo Wallet approval for the Pact funds boundary, and redacted audit evidence after delivery.

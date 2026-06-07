# Agents

Buyer-side agent executor for the demo flow.

Responsibilities:

- Fetch x402 quote and parse the official payment requirement.
- Enforce budget, token, network, payee, method, and resource constraints.
- Query provider status before Pact submission.
- Submit and wait for a CAW Pact only after quote/policy checks pass.
- Execute payment only after explicit operator approval.
- Retry delivery or recover cached delivery instead of paying twice.
- Validate the returned report and write a redacted audit record.

Precheck only:

```bash
npm run consumer -- \
  --precheck-only \
  --address 0x0000000000000000000000000000000000000001 \
  --api http://localhost:4021/risk-report \
  --max-price-usdc 0.005
```

Full payment flow must only be run after explicit operator approval.

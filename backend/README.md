# Backend

Seller-side x402 paid-resource provider.

Endpoints:

- `GET /llms.txt`: provider capability manifest for agent runtimes.
- `GET /risk-report?address={evm_address}`: example x402 paid resource.
- `GET /orders/status?fingerprint=...`: status/recovery lookup before new payment.
- `GET /orders/status?paymentId=...`: status/recovery lookup after payment evidence exists.

Run:

```bash
npm install
npm run provider
```

The backend writes local SQLite runtime state under `data/`, which is ignored by git.

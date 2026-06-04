# @reineira-os/x402-facilitator

Standalone, self-hosted x402 facilitator (verify + settle) for Arbitrum Sepolia.
The hosted CDP facilitator does not cover Sepolia, so we run our own.

## Run

```bash
pnpm dev      # watch mode (tsx) on FACILITATOR_PORT (default 4021)
pnpm build    # bundle with tsup
pnpm start    # node dist/server.js
```

## Endpoints

- `GET /healthz` — liveness
- `GET /supported` — advertised scheme / network / asset
- `POST /verify` — STUB, returns 501 (real logic lands in A2 / DEV-190)
- `POST /settle` — STUB, returns 501 (real logic lands in A2 / DEV-190)

# @reineira-os/x402-facilitator

Standalone, self-hosted x402 facilitator (verify + settle) for Arbitrum Sepolia.
The hosted CDP facilitator does not cover Sepolia, so we run our own.

## Run

```bash
pnpm dev      # watch mode (tsx) on FACILITATOR_PORT (default 4021)
pnpm build    # bundle with tsup
pnpm start    # node dist/server.js
```

## Environment Variables

| Variable                   | Required | Description                                                                                                               |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `FACILITATOR_PRIVATE_KEY`  | yes      | Private key (`0x…`) of the facilitator account; must be funded with Arbitrum Sepolia ETH to pay gas for settle broadcasts |
| `FACILITATOR_PORT`         | no       | HTTP port (default `4021`)                                                                                                |
| `ARBITRUM_SEPOLIA_RPC_URL` | no       | Override the default Arbitrum Sepolia RPC endpoint                                                                        |

## Endpoints

- `GET /healthz` — liveness
- `GET /supported` — advertised scheme / network / asset
- `POST /verify` — validates an x402 v2 `exact` EIP-3009 payment via our own `@reineira-os/x402-core` (EIP-3009-only `exact` scheme; no `@x402/*` runtime deps — the `@x402` packages are kept only as a differential-test oracle in `packages/core`); returns a `VerifyResponse` (`{ isValid, payer? | invalidReason? }`)
- `POST /settle` — broadcasts `transferWithAuthorization` on-chain via the facilitator account and returns a `SettleResponse` (`{ success, transaction?, network? | errorReason? }`)

Network: `eip155:421614` (Arbitrum Sepolia). Asset: USDC `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`.

Both `/verify` and `/settle` accept `{ paymentPayload, paymentRequirements }`. On upstream failure (RPC error, settlement revert) they return `502` with a structured error body rather than an unhandled 500.

## Integration Tests

End-to-end tests in `test/integration.sepolia.test.ts` are skipped by default. Enable them with env gates:

```bash
X402_FACILITATOR_INTEGRATION=1 pnpm test   # runs /verify integration test
X402_FACILITATOR_SETTLE=1 pnpm test        # also runs /settle (broadcasts on-chain)
```

# Settlement Theater (demo)

`@reineira-os/x402-rss-demo` — the single-screen demo for the x402 + RSS
insured-settlement flow.

> **Status: SKELETON.** This package is the scaffold from A (DEV-159). Full demo
> logic — live logs, countdown, progress, and real x402 settlement — lands in B
> (DEV-194).

## Run

From the monorepo root:

```bash
pnpm install
pnpm --filter @reineira-os/x402-rss-demo dev
```

Or from this directory:

```bash
pnpm dev          # next dev on http://localhost:3000
pnpm build        # next build
pnpm typecheck    # tsc --noEmit
```

### Buyer-agent client

A standalone buyer-agent script that hits the 402 resource:

```bash
pnpm --filter @reineira-os/x402-rss-demo agent
# or: RESOURCE_URL=http://localhost:3000/api/resource pnpm agent
```

It performs a `GET /api/resource`, logs the `402 PAYMENT REQUIRED` challenge,
and stops at the stub where EIP-3009 signing + retry-with-payment will go.

## What each zone shows

The home screen is a single-screen, 3-zone layout:

| Zone                       | Position | Shows                                                              |
| -------------------------- | -------- | ----------------------------------------------------------------- |
| **Buyer**                  | left     | Buyer-agent event log (request → 402 → pay → fetch artifact)       |
| **Settlement Theater**     | center   | The deal-card: status, a countdown to deadline, and a progress grid|
| **Provider**               | right    | Provider/resource-server event log (challenge → verify → deliver)  |

In the skeleton, logs are placeholders, the countdown reads `--:--`, and the
progress grid renders empty cells.

## Routes

- `GET /api/resource` — x402 resource server.
  - No `x-payment` header → `402` with an x402 `PAYMENT-REQUIRED` body
    (version 2, scheme `exact`, network `eip155:421614`, USDC asset from
    `@reineira-os/x402-rss-shared`).
  - With `x-payment` header → `200` with a mock batch-inference artifact
    (settlement verification is stubbed for now).

# Deploying to Vercel

This monorepo ships **two** Vercel projects from the same repository:

| Project         | Root Directory         | Framework | What it is                                        |
| --------------- | ---------------------- | --------- | ------------------------------------------------- |
| **Facilitator** | `packages/facilitator` | Other     | x402 settlement facilitator (Hono serverless API) |
| **Demo**        | `apps/demo`            | Next.js   | The insured-settlement showcase UI                |

The Solidity packages (`packages/rss`, `packages/contracts`) are **not** deployed to Vercel —
they are smart contracts, deployed separately to Arbitrum Sepolia.

Deploy the **facilitator first** so you have its URL, then set that URL on the demo.

---

## 1. Facilitator project

**New Project → import this repo → set Root Directory to `packages/facilitator`.**

- Framework Preset: **Other**. No output directory is needed — the `api/` function is the output.
- Install / Build commands come from `packages/facilitator/vercel.json` (they build the
  workspace libraries the facilitator imports). Leave the dashboard overrides off.

Environment variables:

| Variable                   | Required    | Notes                                                                           |
| -------------------------- | ----------- | ------------------------------------------------------------------------------- |
| `FACILITATOR_PRIVATE_KEY`  | ✅          | EOA that relays `receiver.settle`. Needs a little Arbitrum Sepolia ETH for gas. |
| `ARBITRUM_SEPOLIA_RPC_URL` | recommended | e.g. `https://sepolia-rollup.arbitrum.io/rpc`                                   |

After deploy, note the URL (e.g. `https://x402-facilitator.vercel.app`). The endpoints are
served under `/` via the catch-all rewrite (e.g. `POST /verify`, `POST /settle`, `GET /supported`).

---

## 2. Neon Postgres (state for the demo)

The demo persists agent + session state. Locally it uses JSON files; on Vercel the filesystem
is read-only, so it uses **Neon Postgres** instead.

1. In the **Demo** Vercel project → **Storage** (or **Integrations**) → add **Neon Postgres**
   from the Marketplace.
2. Neon auto-injects `DATABASE_URL` (and `POSTGRES_URL`) into the project's env.
3. No migration step needed — the demo runs `CREATE TABLE IF NOT EXISTS kv_store (...)` on first
   request. State lives as two JSONB documents (`agent-store`, `session-store`).

> The store backend is chosen at runtime: `DATABASE_URL`/`POSTGRES_URL` present → Postgres,
> otherwise → local files. So local `pnpm dev` keeps working with zero database setup.

---

## 3. Demo project

**New Project → import this repo again → set Root Directory to `apps/demo`.**

- Framework Preset: **Next.js** (auto-detected).
- Install / Build commands come from `apps/demo/vercel.json` (they build the workspace libs,
  then `next build`). Leave the dashboard overrides off.

Environment variables (copy the values from your local `apps/demo/.env.local`):

| Variable                             | Required  | Notes                                                        |
| ------------------------------------ | --------- | ------------------------------------------------------------ |
| `FACILITATOR_URL`                    | ✅        | URL of the facilitator project from step 1.                  |
| `ANTHROPIC_API_KEY`                  | ✅        | Buying agent's model key.                                    |
| `ARBITRUM_SEPOLIA_RPC_URL`           | ✅        | Arbitrum Sepolia RPC.                                        |
| `DATABASE_URL`                       | ✅ (auto) | Provided by the Neon integration (step 2).                   |
| `ESCROW_ADDRESS`                     | ✅        | Escrow contract.                                             |
| `X402_RECEIVER_ADDRESS`              | ✅        | x402 escrow receiver.                                        |
| `TIMELOCK_RESOLVER_ADDRESS`          | ✅        | TimeLock resolver.                                           |
| `ESCROW_DEADLINE_SECONDS`            | ✅        | Release delay (demo default 90).                             |
| `SELLER_PRIVATE_KEY`                 | ✅        | Seller EOA; receives releases, pays gas to open escrows.     |
| `AGENT_PRIVATE_KEY`                  | ✅        | Default agent's Kernel owner key.                            |
| `ZERODEV_PROJECT_ID`                 | ✅        | ZeroDev project for sponsored userOps.                       |
| `FACILITATOR_PRIVATE_KEY`            | ✅        | Relayer for `receiver.settle` (can match the facilitator's). |
| `COVERAGE_MANAGER_ADDRESS`           | ✅        | Insurance coverage manager.                                  |
| `DELIVERY_POLICY_ADDRESS`            | ✅        | Delivery underwriter policy.                                 |
| `DELIVERY_DEADLINE_RESOLVER_ADDRESS` | ✅        | Delivery deadline resolver.                                  |
| `COVERAGE_POOL_ADDRESS`              | ✅        | Coverage pool.                                               |
| `VAULT_ADDRESS`                      | ✅        | Two-Key Halt protected vault.                                |
| `ALERT_RESOLVER_ADDRESS`             | ✅        | Two-Key alert resolver.                                      |
| `GUARDIAN_PRIVATE_KEY`               | ✅        | Guardian key (pause only).                                   |
| `SENTINEL_PRIVATE_KEY`               | ✅        | Sentinel key (stakes/redeems the bond).                      |
| `BUYER_PRIVATE_KEY`                  | optional  | Legacy EOA direct-pay fallback.                              |

> **Secrets:** these are testnet keys. They live only in `apps/demo/.env.local` (gitignored,
> never committed). Re-enter them in the Vercel dashboard; do not commit them.

---

## 4. Verify

- Facilitator: `GET https://<facilitator>.vercel.app/supported` returns the supported schemes.
- Demo: open the deployment, create an agent, run a purchase — state survives a reload
  (confirms Neon is wired). The agent/session rows appear in the Neon `kv_store` table.

## Notes

- Node version is pinned to 20 (`.nvmrc`, `engines`). pnpm ≥ 9.
- Both projects install from the workspace root automatically (pnpm workspace is detected).
- Preview deployments work the same; give the preview demo its own `FACILITATOR_URL` if you
  also deploy a preview facilitator.

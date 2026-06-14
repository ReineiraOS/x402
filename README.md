# x402-rss

**Insured x402 settlement, built on the Reineira Settlement Standard.**

`x402-rss` routes an [x402](https://x402.org) HTTP-402 payment into a settlement that is
escrow-backed, condition-gated, and optionally covered by an insurance policy — all expressed
against an open conformance standard rather than a single hardcoded contract.

> **RSS = Reineira Settlement Standard** (an open conformance spec — not "Really Simple
> Syndication"). A contract is "RSS-conformant" when it implements the documented semantics of
> `IConditionResolver`, `IUnderwriterPolicy`, or `IFundingSource`.

> **Status: testnet only, work in progress.** This repository is a scaffold. Several packages are
> intentionally stubs (marked in code) pending implementation. Nothing here is a production
> financial product. See [Scope and honesty](#scope-and-honesty).

## Why

x402 is pay-first: an agent pays before it receives anything, so counterparty risk is inherent.
`x402-rss` makes that payment land in a settlement where a missed delivery deadline can trigger a
confidential refund from an insurance pool — instead of the payer simply eating the loss.

## Layout

This is a pnpm + Foundry monorepo.

| Package                | Stack              | What it is                                                                                                                                                               |
| ---------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/rss`         | Solidity (Foundry) | The standard: RSS interfaces and a conformance test suite proven against reference mocks                                                                                 |
| `packages/contracts`   | Solidity (Foundry) | Deployable implementations: `DeliveryDeadlineResolver`, `DeliveryPolicy`, and the `X402EscrowReceiver` funding source                                                    |
| `packages/core`        | TypeScript         | Our own x402 v2 `exact` (EIP-3009-only) implementation; the monorepo's facilitator + buyer adapter run on it, with `@x402/*` kept only as a dev differential-test oracle |
| `packages/x402-rss`    | TypeScript         | The adapter SDK: x402 / EIP-3009 payment to RSS-conformant settlement                                                                                                    |
| `packages/facilitator` | TypeScript (Hono)  | Standalone self-hosted x402 verify + settle server (Arbitrum Sepolia has no hosted facilitator)                                                                          |
| `packages/shared`      | TypeScript         | Shared types, addresses, x402 constants, ABIs                                                                                                                            |
| `apps/demo`            | Next.js 16         | The Payment-agents dashboard: autonomous buyer + seller agents settling on-chain x402 → escrow payments, with a Settlement Theater terminal                              |

## The standard (`packages/rss`)

RSS is three interfaces, two of which ship a semantic conformance suite:

- `IConditionResolver` — decides whether an escrow's release condition is met (and what it has been breached against). **Conformance suite.**
- `IUnderwriterPolicy` — registers coverage, evaluates risk, and judges a claim. **Conformance suite.**
- `IFundingSource` — a pluggable funding entrypoint (x402, CCTP, fiat attestation, trusted claim). Interface-only; conformance suite is roadmap.

The conformance suites assert the _semantics_ of `IConditionResolver` and `IUnderwriterPolicy`, not
just their selectors. Any implementation can inherit a conformance harness to prove it behaves like
the standard expects — the same harness is reused by `packages/contracts` to validate
`DeliveryDeadlineResolver` and `DeliveryPolicy`.

## Quickstart

```bash
pnpm install

# Solidity
pnpm compile           # forge build for rss + contracts
pnpm test:contracts    # forge test for rss + contracts

# Everything (TS builds/tests + Solidity)
pnpm build
pnpm test
```

Foundry is required (`forge`). Solidity is `0.8.25` (cancun). Copy `.env.example` to `.env` and fill
in the Arbitrum Sepolia values before deploying.

## Demo

`apps/demo` stages an agentic peer-to-peer deal: an autonomous buyer agent pays a seller agent via
x402 for a deadline-bound resource. The settled resource is a **live on-chain data report** (current
Arbitrum Sepolia block + gas + ETH/USD spot, fetched fresh at request time). Deliver in time and the
deal releases; miss the deadline and a dispute auto-refunds the buyer from the coverage pool,
confidentially. A Settlement Theater terminal surfaces each step, with the on-chain settlement on
Arbitrum Sepolia.

```bash
pnpm --filter @reineira-os/x402-rss-demo dev
```

## Scope and honesty

This is a testnet demonstration of a mechanism, not a live service:

- **Insurance pool is hollow.** The on-chain pool economics (premium split, claim discretion, real
  LP capital) are not implemented. The demo proves the `dispute()` to `payClaim` _mechanism_ works on
  testnet; it does not represent a working insurance product.
- **The product is the rail, not a marketplace.** The paid resource is a real live on-chain data
  report, but it is a stand-in for "some deliverable." This project is the settlement rail, not a
  compute or data marketplace.
- **No stats.** There are no usage, volume, or install figures here, real or implied.
- **Built with** [Fhenix](https://www.fhenix.io) (confidential settlement via FHE) and
  [Arbitrum](https://arbitrum.io). Other tools are name-mentions, not endorsements.

## License

[MIT](./LICENSE) © 2026 Reineira Labs Limited.

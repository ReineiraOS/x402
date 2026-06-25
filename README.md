# x402

[![npm](https://img.shields.io/npm/v/@reineira-os/x402.svg)](https://www.npmjs.com/package/@reineira-os/x402) [![CI](https://github.com/ReineiraOS/x402/actions/workflows/ci.yml/badge.svg)](https://github.com/ReineiraOS/x402/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**Insured, FHE-confidential x402 settlement on the Reineira Settlement Standard.**

`@reineira-os/x402` routes an [x402](https://x402.org) HTTP-402 payment into a settlement that is
escrow-backed, condition-gated, optionally covered by an insurance policy, and — on the confidential
profile — **encrypted on-chain**: the settled amount, coverage, and refund are `euint64` ciphertext
that only the buyer or seller can decrypt via a [Fhenix](https://www.fhenix.io) permit. It is all
expressed against an open conformance standard rather than a single hardcoded contract.

> **RSS = Reineira Settlement Standard** (an open conformance spec — not "Really Simple
> Syndication"). A contract is "RSS-conformant" when it implements the documented semantics of
> `IConditionResolver`, `IUnderwriterPolicy`, or `IFundingSource` — or their confidential variants.

> **Status: Arbitrum Sepolia testnet, pre-1.0.** Packages publish at `0.1.x`; the APIs may still
> evolve. The confidential settlement stack is deployed on Arbitrum Sepolia and the
> encrypt → on-chain → decrypt round-trip is proven by a live test. Insurance-pool economics are
> demonstration-grade. See [Scope and honesty](#scope-and-honesty).

## Why

x402 is pay-first: an agent pays before it receives anything, so counterparty risk is inherent.
`@reineira-os/x402` makes that payment land in a settlement where a missed delivery deadline can trigger a
**confidential refund** from an insurance pool — instead of the payer simply eating the loss. The
payment wire (EIP-3009, plaintext value) is unchanged; confidentiality is a property of the
_settlement target_, not the payment scheme, so the x402 client and facilitator stay standard.

## Install

```bash
pnpm add @reineira-os/x402 @reineira-os/x402-core
```

The Solidity standard and deployable implementations are published too, for importing into Foundry
projects:

```bash
pnpm add @reineira-os/rss @reineira-os/x402-contracts
```

## Packages

| Package                         | Stack              | What it is                                                                          |
| ------------------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `@reineira-os/rss`              | Solidity (Foundry) | The standard: RSS interfaces + conformance suites, incl. the confidential profile   |
| `@reineira-os/x402-contracts`   | Solidity (Foundry) | Deployable implementations: delivery resolver/policy, X402 + confidential receivers |
| `@reineira-os/x402-core`        | TypeScript         | SDK: x402 `exact` (EIP-3009) scheme, escrow funding, and the Fhenix FHE codec       |
| `@reineira-os/x402`             | TypeScript         | Umbrella adapter SDK: x402 / EIP-3009 payment → RSS-conformant settlement           |
| `@reineira-os/x402-facilitator` | TypeScript (Hono)  | Self-hostable x402 verify + settle server (Arbitrum Sepolia has no hosted one)      |
| `@reineira-os/x402-shared`      | TypeScript         | Shared types, addresses, x402 constants, ABIs                                       |

A reference dashboard (autonomous buyer + seller agents settling on-chain, with a Settlement Theater
that shows the on-chain ciphertext and an authorized-party "reveal") lives in
[`ReineiraOS/examples`](https://github.com/ReineiraOS/examples/tree/main/solutions/x402-insured-settlement)
and is deployed live at **[x402.reineira.xyz](https://x402.reineira.xyz)**.

## The standard (`@reineira-os/rss`)

RSS is a small set of interfaces, each shipping a semantic conformance suite (asserting behavior, not
just selectors), reused by `@reineira-os/x402-contracts` to validate its implementations:

- `IConditionResolver` — decides whether an escrow's release condition is met. **Conformance suite.**
- `IUnderwriterPolicy` — registers coverage, evaluates risk, judges a claim. **Conformance suite.**
- `IFundingSource` — a pluggable funding entrypoint (x402, CCTP, fiat attestation). Interface-only.

### Confidential profile (FHE)

The confidential profile mirrors those interfaces over Fhenix encrypted types — `euint64` amounts,
`ebool` verdicts — so settlement amounts, coverage, and refunds are stored as ciphertext on-chain:

- `IConfidentialFundingSource`, `IConfidentialUnderwriterPolicy`, `IConfidentialConditionResolver`,
  each with a conformance suite.
- The resolver follows an **encrypted-threshold / public-verdict** model: the floor stays secret
  (`euint64`), only the breach bit is revealed (the halt is public anyway).

Only the buyer or seller — holders of the relevant Fhenix permit — can decrypt the amounts.

## Quickstart (development)

```bash
pnpm install

# Solidity (requires Foundry / forge)
pnpm compile           # forge build for rss + contracts
pnpm test:contracts    # forge test for rss + contracts

# Everything (TS builds/tests + Solidity)
pnpm build
pnpm test
```

Solidity is `0.8.25` (cancun). Copy `.env.example` to `.env` and fill in the Arbitrum Sepolia values
before deploying or running scripts.

## Deployed (Arbitrum Sepolia)

The confidential stack is deployed and a coverage pool is provisioned on Arbitrum Sepolia. The
authoritative address set is wired through environment variables — see `.env.example` for the
`CONFIDENTIAL_*` and escrow/receiver/resolver variables, and each package's deployment records.

## Scope and honesty

This is a testnet demonstration of a mechanism that is now functional, not a live financial product:

- **Settlement is implemented.** The `X402EscrowReceiver` funding source and the confidential
  receiver are functional; an x402 payment settles into an (optionally confidential) escrow on
  Arbitrum Sepolia. The encrypt → on-chain → decrypt round-trip is covered by a live test.
- **Insurance economics are demonstration-grade.** The on-chain pool exists and is funded on testnet,
  and the `dispute()` → `payClaim` mechanism works, but premium splits, claim discretion, and real LP
  economics are not a production insurance product.
- **The product is the rail, not a marketplace.** The reference demo's paid resource is a real live
  on-chain data report, but it stands in for "some deliverable."
- **No stats.** There are no usage, volume, or install figures here, real or implied.
- **Built with** [Fhenix](https://www.fhenix.io) (confidential settlement via FHE) and
  [Arbitrum](https://arbitrum.io). Other tools are name-mentions, not endorsements.

## License

[MIT](./LICENSE) © 2026 Reineira Labs Limited.

# @reineira-os/x402-core

The x402 confidential-settlement SDK — an `exact` (EIP-3009) scheme implementation, escrow funding,
and the Fhenix FHE codec (encrypt/decrypt of `euint64` settlement amounts).

> Part of [**x402**](https://github.com/ReineiraOS/x402) — insured, FHE-confidential settlement on the [Reineira Settlement Standard](https://www.npmjs.com/package/@reineira-os/rss).

## Install

```bash
pnpm add @reineira-os/x402-core
```

## Subpath exports

| Import                                | What                                              |
| ------------------------------------- | ------------------------------------------------- |
| `@reineira-os/x402-core`              | top-level SDK                                     |
| `@reineira-os/x402-core/exact/client` | `exact` (EIP-3009) payment client                 |
| `@reineira-os/x402-core/exact/escrow` | escrow-bound funding (`receiveWithAuthorization`) |
| `@reineira-os/x402-core/exact/verify` | facilitator-side verify                           |
| `@reineira-os/x402-core/exact/settle` | facilitator-side settle                           |
| `@reineira-os/x402-core/http`         | x402 HTTP helpers (402 parsing, headers)          |
| `@reineira-os/x402-core/types`        | shared types                                      |
| `@reineira-os/x402-core/facilitator`  | facilitator app factory                           |

## License

MIT © Reineira Labs

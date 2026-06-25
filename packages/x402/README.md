# @reineira-os/x402

The buyer-side x402 adapter for Arbitrum Sepolia — a thin, batteries-included wrapper over
[`@reineira-os/x402-core`](https://www.npmjs.com/package/@reineira-os/x402-core)'s `exact` client,
preconfigured for the `eip155:421614` `exact` (EIP-3009) scheme and Arbitrum Sepolia USDC.

> The headline package of [**x402**](https://github.com/ReineiraOS/x402) — insured, FHE-confidential settlement on the [Reineira Settlement Standard](https://www.npmjs.com/package/@reineira-os/rss).

## Install

```bash
pnpm add @reineira-os/x402
```

## Usage

```ts
import { createX402RssFetch } from "@reineira-os/x402";
import { privateKeyToAccount } from "viem/accounts";

const fetchPaid = createX402RssFetch({ account: privateKeyToAccount(PK) });
const res = await fetchPaid("https://provider.example/job");
```

`createX402RssFetch` returns a payment-aware `fetch`: on an HTTP `402` it signs an `exact`
authorization for the requested `payTo`/amount and retries with the `PAYMENT-SIGNATURE` header. A
`maxValue` cap (default 10 USDC) rejects a payment that exceeds the limit before signing.

Built on `@reineira-os/x402-core`: plain pays settle via `transferWithAuthorization`; escrow-bound
pays settle via `receiveWithAuthorization`.

## License

MIT © Reineira Labs

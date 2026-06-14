# @reineira-os/x402-rss

MIT buyer-side x402 adapter for Arbitrum Sepolia. A thin wrapper over our own
`@reineira-os/x402-core` `exact` client, preconfigured for the `eip155:421614`
`exact` (EIP-3009) scheme and the Arbitrum Sepolia USDC.

## Usage

```ts
import { createX402RssFetch } from "@reineira-os/x402-rss";
import { privateKeyToAccount } from "viem/accounts";

const fetchPaid = createX402RssFetch({ account: privateKeyToAccount(PK) });
const res = await fetchPaid("https://provider.example/job");
```

`createX402RssFetch` returns a payment-aware `fetch`: on an HTTP `402` it signs an
`exact` authorization for the requested `payTo`/amount and retries with the
`PAYMENT-SIGNATURE` header. A `maxValue` cap (default 10 USDC) rejects a payment
that exceeds the limit before signing.

Built on `@reineira-os/x402-core`. Plain pays settle via
`transferWithAuthorization`; escrow-bound pays settle via
`receiveWithAuthorization` (both implemented in core).

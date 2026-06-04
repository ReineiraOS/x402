# @reineira-os/x402-rss

Flagship MIT adapter SDK that routes an x402 / EIP-3009 payment into RSS-conformant
settlement: escrow funding, condition gating, and insurance coverage.

It exposes a single entry point, `createX402RssClient(config)`, returning a typed
client with `quote()` and `settle()` methods.

> Scaffold stub only. The factory and types are in place, but `quote()` and
> `settle()` currently throw `x402-rss: not implemented (A1 / DEV-189)`. Real
> settlement logic lands in A1 (DEV-189).

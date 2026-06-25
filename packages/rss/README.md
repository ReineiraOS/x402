# @reineira-os/rss

The **Reineira Settlement Standard (RSS)** — Solidity interfaces and semantic conformance suites for
condition-gated, insured settlement, including the confidential (FHE) profile.

> The open standard the [**x402**](https://github.com/ReineiraOS/x402) adapter conforms to — other adapters can implement the same interfaces.

## Install

```bash
pnpm add @reineira-os/rss
```

## Interfaces

`IConditionResolver`, `IUnderwriterPolicy`, `IFundingSource`, plus the confidential variants
(`IConfidentialConditionResolver`, `IConfidentialUnderwriterPolicy`, `IConfidentialFundingSource`).
Each shipped interface carries a conformance suite that asserts behavior, not just selectors.

## License

MIT © Reineira Labs

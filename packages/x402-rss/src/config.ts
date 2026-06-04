import { ARBITRUM_SEPOLIA, X402 } from "@reineira-os/x402-rss-shared";

export const arbitrumSepolia = {
  chainId: ARBITRUM_SEPOLIA.chainId,
  usdc: ARBITRUM_SEPOLIA.usdc,
  network: X402.network,
  scheme: X402.scheme,
  defaultMaxValue: 10_000_000n,
} as const;

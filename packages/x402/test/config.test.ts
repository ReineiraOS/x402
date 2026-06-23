import { describe, it, expect } from "vitest";
import { arbitrumSepolia } from "../src/config.js";
import { ARBITRUM_SEPOLIA, X402 } from "@reineira-os/x402-shared";

describe("arbitrumSepolia config", () => {
  it("matches the shared Arbitrum Sepolia + x402 constants", () => {
    expect(arbitrumSepolia.chainId).toBe(ARBITRUM_SEPOLIA.chainId); // 421614
    expect(arbitrumSepolia.usdc).toBe(ARBITRUM_SEPOLIA.usdc);
    expect(arbitrumSepolia.network).toBe(X402.network); // "eip155:421614"
    expect(arbitrumSepolia.scheme).toBe(X402.scheme); // "exact"
    expect(arbitrumSepolia.defaultMaxValue).toBeGreaterThan(0n);
  });
});

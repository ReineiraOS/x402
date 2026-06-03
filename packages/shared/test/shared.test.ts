import { describe, expect, it } from "vitest";
import { ARBITRUM_SEPOLIA, X402 } from "../src/index.js";

describe("shared", () => {
  it("exposes the known Arbitrum Sepolia USDC address", () => {
    expect(ARBITRUM_SEPOLIA.usdc).toBe(
      "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    );
  });

  it("uses the exact x402 scheme", () => {
    expect(X402.scheme).toBe("exact");
  });
});

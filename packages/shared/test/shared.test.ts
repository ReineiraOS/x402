import { describe, expect, it } from "vitest";
import { ARBITRUM_SEPOLIA, X402, erc3009Abi, escrowAbi } from "../src/index.js";

describe("shared", () => {
  it("exposes the known Arbitrum Sepolia USDC address", () => {
    expect(ARBITRUM_SEPOLIA.usdc).toBe("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
  });

  it("uses the exact x402 scheme", () => {
    expect(X402.scheme).toBe("exact");
  });

  it("exposes the EIP-3009 authorization functions in erc3009Abi", () => {
    const fns = erc3009Abi.filter((e) => e.type === "function").map((e) => e.name);
    expect(fns).toContain("transferWithAuthorization");
    expect(fns).toContain("receiveWithAuthorization");
    expect(fns).toContain("authorizationState");
  });

  it("exposes the IEscrow funding surface in escrowAbi", () => {
    const fns = escrowAbi.filter((e) => e.type === "function").map((e) => e.name);
    expect(fns).toContain("fund");
    expect(fns).toContain("getPaidAmount");
  });
});

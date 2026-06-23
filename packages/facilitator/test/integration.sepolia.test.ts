import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { PaymentPayload, PaymentRequirements } from "@reineira-os/x402-core/types";
import { ARBITRUM_SEPOLIA, X402 } from "@reineira-os/x402-rss-shared";
import { createFacilitator } from "../src/facilitator.js";

const RUN = process.env.X402_FACILITATOR_INTEGRATION === "1";
const SETTLE = process.env.X402_FACILITATOR_SETTLE === "1";
const PRIVATE_KEY = (process.env.FACILITATOR_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`;

const PAY_TO = "0x000000000000000000000000000000000000dEaD" as `0x${string}`;
const PAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`;
const DUMMY_SIGNATURE = ("0x" + "ab".repeat(65)) as `0x${string}`;

const paymentRequirements: PaymentRequirements = {
  scheme: X402.scheme,
  network: X402.network,
  asset: ARBITRUM_SEPOLIA.usdc,
  amount: "1000000",
  payTo: PAY_TO,
  maxTimeoutSeconds: 120,
  extra: { name: X402.eip712.name, version: X402.eip712.version },
};

const paymentPayload: PaymentPayload = {
  x402Version: X402.version,
  resource: { url: "https://example.test/job" },
  accepted: paymentRequirements,
  payload: {
    signature: DUMMY_SIGNATURE,
    authorization: {
      from: PAYER,
      to: PAY_TO,
      value: "1000000",
      validAfter: "0",
      validBefore: String(Math.floor(Date.now() / 1000) + 120),
      nonce: "0x" + "cc".repeat(32),
    },
  },
};

describe.runIf(RUN)("facilitator Sepolia integration", () => {
  it("verify() returns a structured VerifyResponse for an exact payment fixture", async () => {
    const facilitator = createFacilitator({
      account: privateKeyToAccount(PRIVATE_KEY),
      rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL,
    });

    const result = await facilitator.verify(paymentPayload, paymentRequirements);

    expect(typeof result.isValid).toBe("boolean");
  });

  it.runIf(SETTLE)("settle() returns a structured SettleResponse", async () => {
    const facilitator = createFacilitator({
      account: privateKeyToAccount(PRIVATE_KEY),
      rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL,
    });

    const result = await facilitator.settle(paymentPayload, paymentRequirements);

    expect(typeof result.success).toBe("boolean");
  });
});

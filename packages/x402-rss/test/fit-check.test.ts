import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { wrapFetchWithPayment, x402Client } from "@reineira-os/x402-core/exact/client";
import { ExactEvmScheme, toClientEvmSigner } from "@reineira-os/x402-core/exact/client";

describe("x402 v2 client reuse fit-check (Arbitrum Sepolia)", () => {
  it("registers an exact EVM scheme for eip155:421614 and wraps fetch", () => {
    const account = privateKeyToAccount(
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    );
    const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http() });
    const signer = toClientEvmSigner(account, publicClient);
    const client = new x402Client().register("eip155:421614", new ExactEvmScheme(signer));
    const wrapped = wrapFetchWithPayment(fetch, client);
    expect(typeof wrapped).toBe("function");
  });
});

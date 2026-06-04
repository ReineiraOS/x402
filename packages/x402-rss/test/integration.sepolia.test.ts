import { describe, it, expect } from "vitest";
import { createPublicClient, http } from "viem";
import { arbitrumSepolia as arbitrumSepoliaChain } from "viem/chains";
import { arbitrumSepolia } from "../src/config.js";

const RUN = process.env.X402_RSS_INTEGRATION === "1";
const RPC_URL = process.env.ARBITRUM_SEPOLIA_RPC_URL;

const erc20Abi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

describe.runIf(RUN)("Arbitrum Sepolia integration", () => {
  const client = createPublicClient({ chain: arbitrumSepoliaChain, transport: http(RPC_URL) });

  it("reaches chain 421614", async () => {
    expect(await client.getChainId()).toBe(arbitrumSepolia.chainId);
  });

  it("USDC asset matches the config's EIP-712 domain assumptions", async () => {
    const usdc = arbitrumSepolia.usdc as `0x${string}`;
    const [name, decimals] = await Promise.all([
      client.readContract({ address: usdc, abi: erc20Abi, functionName: "name" }),
      client.readContract({ address: usdc, abi: erc20Abi, functionName: "decimals" }),
    ]);
    expect(name).toBe("USD Coin");
    expect(decimals).toBe(6);
  });
});

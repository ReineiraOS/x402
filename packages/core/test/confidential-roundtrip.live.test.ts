import { describe, it, expect } from "vitest";
import { createPublicClient, createWalletClient, http, getAddress } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createConfidentialClient } from "../src/exact/confidential.js";
import {
  createConfidentialEscrow,
  readConfidentialAmount,
} from "../src/exact/confidential-escrow.js";

const RUN = process.env.RUN_LIVE_FHE === "1";

describe.skipIf(!RUN)("live confidential round-trip (Arbitrum Sepolia)", () => {
  it("encrypts → creates a confidential escrow → reads → decrypts the amount", async () => {
    const rpc = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
    const key = process.env.SELLER_PRIVATE_KEY! as `0x${string}`;
    const escrow = getAddress(process.env.CONFIDENTIAL_ESCROW_ADDRESS!);
    const resolver = "0x0000000000000000000000000000000000000000" as const;
    const account = privateKeyToAccount(key);
    const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
    const walletClient = createWalletClient({
      account,
      chain: arbitrumSepolia,
      transport: http(rpc),
    });

    const fhe = await createConfidentialClient({ walletClient, publicClient });
    const amount = 250000n;
    const { escrowId } = await createConfidentialEscrow(
      fhe,
      { publicClient, walletClient },
      { escrow, owner: account.address, amount, resolver, resolverData: "0x" },
    );
    const decrypted = await readConfidentialAmount(
      fhe,
      { publicClient, walletClient },
      { escrow, escrowId },
    );
    expect(decrypted).toBe(amount);
  }, 120_000);
});

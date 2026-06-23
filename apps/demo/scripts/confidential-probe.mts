import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  createConfidentialClient,
  createConfidentialEscrow,
  readConfidentialAmount,
} from "@reineira-os/x402-core";

const RPC = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
const KEY = process.env.SELLER_PRIVATE_KEY as `0x${string}`;
const ESCROW = getAddress(process.env.CONFIDENTIAL_ESCROW_ADDRESS!);
const RESOLVER = getAddress(process.env.DELIVERY_DEADLINE_RESOLVER_ADDRESS!);

async function main() {
  const account = privateKeyToAccount(KEY);
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(RPC) });
  const fhe = await createConfidentialClient({ walletClient, publicClient });
  const viem = { publicClient, walletClient };

  const amount = 100000n;
  const { escrowId } = await createConfidentialEscrow(fhe, viem, {
    escrow: ESCROW,
    owner: account.address,
    amount,
    resolver: RESOLVER,
    resolverData: "0x",
  });
  console.log(`created confidential escrow ${escrowId} owner=${account.address}`);

  const decrypted = await readConfidentialAmount(fhe, viem, { escrow: ESCROW, escrowId });
  console.log(`seller decrypt getAmount => ${decrypted} (expected ${amount}) ok=${decrypted === amount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

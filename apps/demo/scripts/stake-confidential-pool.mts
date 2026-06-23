import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createConfidentialClient, encryptUint64 } from "@reineira-os/x402-core";

const RPC = process.env.ARBITRUM_SEPOLIA_RPC_URL;
const KEY = (process.env.STAKER_PRIVATE_KEY ?? process.env.SELLER_PRIVATE_KEY) as
  | `0x${string}`
  | undefined;
const POOL = process.env.POOL_ADDRESS;
const AMOUNT = BigInt(process.env.STAKE_AMOUNT ?? "1500000");

const poolAbi = [
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "encryptedAmount",
        type: "tuple",
        components: [
          { name: "ctHash", type: "uint256" },
          { name: "securityZone", type: "uint8" },
          { name: "utype", type: "uint8" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "stakeId", type: "uint256" }],
  },
] as const;

async function main() {
  if (!RPC || !KEY || !POOL) {
    throw new Error("set ARBITRUM_SEPOLIA_RPC_URL, STAKER_PRIVATE_KEY|SELLER_PRIVATE_KEY, POOL_ADDRESS");
  }
  const account = privateKeyToAccount(KEY);
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(RPC) });
  console.log(`staker=${account.address} pool=${getAddress(POOL)} amount=${AMOUNT}`);

  const fhe = await createConfidentialClient({ walletClient, publicClient });
  const enc = await encryptUint64(fhe, AMOUNT);
  console.log(`encrypted stake input ctHash=${enc.ctHash}`);

  const { request } = await publicClient.simulateContract({
    account,
    address: getAddress(POOL),
    abi: poolAbi,
    functionName: "stake",
    args: [enc],
  });
  const hash = await walletClient.writeContract(request);
  console.log(`stake tx=${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`status=${receipt.status}`);
  if (receipt.status !== "success") throw new Error("stake reverted");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

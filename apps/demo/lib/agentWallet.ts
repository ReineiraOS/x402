import {
  createPublicClient,
  encodeFunctionData,
  http,
  zeroAddress,
  type Hex,
  type PublicClient,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { ARBITRUM_SEPOLIA } from "@reineira-os/x402-rss-shared";
import type { ClientEvmSigner } from "@reineira-os/x402-core/exact/client";
import { ZERODEV_PROJECT_ID, zerodevBundlerRpc } from "./zerodev";

const erc20Abi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface AgentWallet {
  address: `0x${string}`;
  ownerAddress: `0x${string}`;
  signer: ClientEvmSigner;
  isDeployed(): Promise<boolean>;
  deployIfNeeded(): Promise<{ deployedNow: boolean; txHash?: `0x${string}` }>;
  usdcBalance(): Promise<bigint>;
  sweepUsdc(
    to: `0x${string}`,
    amount?: bigint,
  ): Promise<{ txHash: `0x${string}`; amount: bigint }>;
}

export interface CreateAgentWalletOptions {
  rpcUrl?: string;
  zerodevProjectId?: string;
  usdcAddress?: `0x${string}`;
}

export async function createAgentWallet(
  ownerPrivateKey: Hex,
  opts: CreateAgentWalletOptions = {},
): Promise<AgentWallet> {
  const rpcUrl =
    opts.rpcUrl ??
    process.env.ARBITRUM_SEPOLIA_RPC_URL ??
    "https://sepolia-rollup.arbitrum.io/rpc";
  const projectId = opts.zerodevProjectId ?? ZERODEV_PROJECT_ID;
  const usdcAddress = opts.usdcAddress ?? (ARBITRUM_SEPOLIA.usdc as `0x${string}`);

  const publicClient: PublicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  });

  const owner = privateKeyToAccount(ownerPrivateKey);
  const entryPoint = getEntryPoint("0.7");
  const kernelVersion = KERNEL_V3_1;

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: owner,
    entryPoint,
    kernelVersion,
  });

  const account = await createKernelAccount(publicClient, {
    entryPoint,
    kernelVersion,
    plugins: { sudo: ecdsaValidator },
  });

  const paymasterClient = createZeroDevPaymasterClient({
    chain: arbitrumSepolia,
    transport: http(zerodevBundlerRpc(projectId)),
  });

  const kernelClient = createKernelAccountClient({
    account,
    chain: arbitrumSepolia,
    bundlerTransport: http(zerodevBundlerRpc(projectId)),
    client: publicClient,
    paymaster: paymasterClient,
  });

  const isDeployed = async (): Promise<boolean> => {
    const code = await publicClient.getCode({ address: account.address });
    return Boolean(code && code !== "0x");
  };

  const sendSponsoredCalls = async (
    calls: { to: `0x${string}`; value: bigint; data: Hex }[],
  ): Promise<`0x${string}`> => {
    const userOpHash = await kernelClient.sendUserOperation({ calls });
    const receipt = await kernelClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });
    if (!receipt.success) {
      throw new Error(
        `UserOperation reverted in tx ${receipt.receipt.transactionHash}`,
      );
    }
    return receipt.receipt.transactionHash;
  };

  return {
    address: account.address,
    ownerAddress: owner.address,

    signer: {
      address: account.address,
      signTypedData: (message) =>
        account.signTypedData(
          message as Parameters<typeof account.signTypedData>[0],
        ),
      readContract: (args) =>
        publicClient.readContract(
          args as Parameters<PublicClient["readContract"]>[0],
        ),
    },

    isDeployed,

    deployIfNeeded: async () => {
      if (await isDeployed()) {
        return { deployedNow: false };
      }
      const txHash = await sendSponsoredCalls([
        { to: zeroAddress, value: 0n, data: "0x" },
      ]);
      return { deployedNow: true, txHash };
    },

    usdcBalance: () =>
      publicClient.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      }),

    sweepUsdc: async (to, amount) => {
      const balance = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      });
      const value = amount ?? balance;
      if (value === 0n || value > balance) {
        throw new Error(
          `Insufficient USDC to sweep: have ${balance}, want ${value}`,
        );
      }
      const txHash = await sendSponsoredCalls([
        {
          to: usdcAddress,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [to, value],
          }),
        },
      ]);
      return { txHash, amount: value };
    },
  };
}

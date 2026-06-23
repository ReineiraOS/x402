import { createPublicClient, getAddress, http, zeroAddress, type PublicClient } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createKernelAccountClient, createZeroDevPaymasterClient } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { deserializePermissionAccount } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import type { ClientEvmSigner } from "@reineira-os/x402-core/exact/client";
import { getSession } from "./sessionStore";
import { zerodevBundlerRpc } from "./zerodev";

// v3 bundler + paymaster. The v3 paymaster sponsors ECDSA userOps (which is what the
// installed session key signs with). The one WebAuthn op (deploy + enable the session
// key) isn't sponsored ("wapk") — it self-funds via the fallback below; everything
// after is gasless.
const ZERODEV_RPC = zerodevBundlerRpc();
const RPC = process.env.ARBITRUM_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";

const entryPoint = getEntryPoint("0.7");
const kernelVersion = KERNEL_V3_1;

// An x402 buyer signer backed by the passkey treasury via its session key. The agent's
// deal pays from the treasury (not a per-agent wallet): the session key signs the
// EIP-3009 authorization, which the facilitator verifies over ERC-1271.
export async function getTreasurySigner(
  treasury: string,
): Promise<{ signer: ClientEvmSigner; budgetAtomic: string | null; spentAtomic: string } | null> {
  const session = await getSession(treasury);
  if (!session?.approval) return null;

  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(RPC),
  }) as PublicClient;
  const sessionKeySigner = await toECDSASigner({
    signer: privateKeyToAccount(session.sessionKeyPrivateKey),
  });
  const account = await deserializePermissionAccount(
    publicClient,
    entryPoint,
    kernelVersion,
    session.approval,
    sessionKeySigner,
  );

  return {
    signer: {
      address: account.address,
      signTypedData: (message) =>
        account.signTypedData(message as Parameters<typeof account.signTypedData>[0]),
      readContract: (args) =>
        publicClient.readContract(args as Parameters<PublicClient["readContract"]>[0]),
    },
    budgetAtomic: session.budgetAtomic ?? null,
    spentAtomic: session.spentAtomic ?? "0",
  };
}

// A passkey treasury is counterfactual until its first on-chain userOp. EIP-3009
// payments are off-chain signatures (no userOp), so a fresh treasury would never get
// deployed → its ERC-1271 signature fails verification ("invalid_exact_evm_signature").
// Send one sponsored session-key no-op userOp to deploy the account + install the
// permission, so subsequent x402 payments verify over ERC-1271.
export async function ensureTreasuryDeployed(
  treasury: string,
): Promise<{ deployedNow: boolean; txHash?: `0x${string}` }> {
  const session = await getSession(treasury);
  if (!session?.approval) throw new Error("no session grant for this treasury");

  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(RPC),
  }) as PublicClient;
  const code = await publicClient.getCode({ address: getAddress(treasury) });
  if (code && code !== "0x") return { deployedNow: false };

  const sessionKeySigner = await toECDSASigner({
    signer: privateKeyToAccount(session.sessionKeyPrivateKey),
  });
  const account = await deserializePermissionAccount(
    publicClient,
    entryPoint,
    kernelVersion,
    session.approval,
    sessionKeySigner,
  );
  const kernelClient = createKernelAccountClient({
    account,
    chain: arbitrumSepolia,
    bundlerTransport: http(ZERODEV_RPC),
    client: publicClient,
    paymaster: {
      getPaymasterData: (userOperation) =>
        createZeroDevPaymasterClient({
          chain: arbitrumSepolia,
          transport: http(ZERODEV_RPC),
        }).sponsorUserOperation({ userOperation }),
    },
  });
  const userOpHash = await kernelClient.sendUserOperation({
    calls: [{ to: zeroAddress, value: 0n, data: "0x" }],
  });
  const receipt = await kernelClient.waitForUserOperationReceipt({ hash: userOpHash });
  if (!receipt.success) {
    throw new Error(`treasury activation reverted in tx ${receipt.receipt.transactionHash}`);
  }
  return { deployedNow: true, txHash: receipt.receipt.transactionHash as `0x${string}` };
}

// Send an arbitrary sponsored call from the passkey treasury via its server-held
// session key. Used for the insurance claim (treasury = the coverage holder, so the
// dispute must originate from it) — the payout lands back in the treasury.
export async function sendFromTreasury(
  treasury: string,
  to: `0x${string}`,
  data: `0x${string}`,
  value = 0n,
): Promise<`0x${string}`> {
  const session = await getSession(treasury);
  if (!session?.approval) throw new Error("no session grant for this treasury");

  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(RPC),
  }) as PublicClient;
  const sessionKeySigner = await toECDSASigner({
    signer: privateKeyToAccount(session.sessionKeyPrivateKey),
  });
  const account = await deserializePermissionAccount(
    publicClient,
    entryPoint,
    kernelVersion,
    session.approval,
    sessionKeySigner,
  );
  const kernelClient = createKernelAccountClient({
    account,
    chain: arbitrumSepolia,
    bundlerTransport: http(ZERODEV_RPC),
    client: publicClient,
    paymaster: {
      getPaymasterData: (userOperation) =>
        createZeroDevPaymasterClient({
          chain: arbitrumSepolia,
          transport: http(ZERODEV_RPC),
        }).sponsorUserOperation({ userOperation }),
    },
  });
  const userOpHash = await kernelClient.sendUserOperation({ calls: [{ to, value, data }] });
  const receipt = await kernelClient.waitForUserOperationReceipt({ hash: userOpHash });
  if (!receipt.success) {
    throw new Error(`treasury call reverted in tx ${receipt.receipt.transactionHash}`);
  }
  return receipt.receipt.transactionHash as `0x${string}`;
}

import { getAddress, parseEventLogs, type Hex, type PublicClient, type WalletClient } from "viem";
import { confidentialEscrowAbi } from "@reineira-os/x402-rss-shared";
import {
  encryptAddress,
  encryptUint64,
  decryptUint64,
  type ConfidentialClient,
} from "./confidential.js";

export type ConfidentialViem = {
  publicClient: PublicClient;
  walletClient: WalletClient;
};

export type CreateConfidentialEscrowParams = {
  escrow: `0x${string}`;
  owner: `0x${string}`;
  amount: bigint;
  resolver: `0x${string}`;
  resolverData: Hex;
};

export async function createConfidentialEscrow(
  fhe: ConfidentialClient,
  viem: ConfidentialViem,
  params: CreateConfidentialEscrowParams,
): Promise<{ escrowId: bigint; txHash: `0x${string}` }> {
  const encryptedOwner = await encryptAddress(fhe, params.owner);
  const encryptedAmount = await encryptUint64(fhe, params.amount);

  const { request } = await viem.publicClient.simulateContract({
    account: viem.walletClient.account!,
    address: params.escrow,
    abi: confidentialEscrowAbi,
    functionName: "create",
    args: [encryptedOwner, encryptedAmount, params.resolver, params.resolverData],
  });
  const txHash = await viem.walletClient.writeContract(request);
  const receipt = await viem.publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`confidential escrow create reverted in ${txHash}`);
  }

  const created = parseEventLogs({
    abi: confidentialEscrowAbi,
    eventName: "EscrowCreated",
    logs: receipt.logs,
  }).find((entry) => getAddress(entry.address) === getAddress(params.escrow));
  if (created) {
    return { escrowId: created.args.escrowId, txHash };
  }

  const total = (await viem.publicClient.readContract({
    address: params.escrow,
    abi: confidentialEscrowAbi,
    functionName: "total",
  })) as bigint;
  const candidate = total - 1n;
  return { escrowId: candidate, txHash };
}

export async function readConfidentialAmount(
  fhe: ConfidentialClient,
  viem: ConfidentialViem,
  params: { escrow: `0x${string}`; escrowId: bigint },
): Promise<bigint> {
  const handle = (await viem.publicClient.readContract({
    address: params.escrow,
    abi: confidentialEscrowAbi,
    functionName: "getAmount",
    args: [params.escrowId],
  })) as bigint;
  return decryptUint64(fhe, handle);
}

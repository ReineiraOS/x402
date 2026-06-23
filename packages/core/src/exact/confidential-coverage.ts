import { encodeAbiParameters, getAddress, parseEventLogs, type Hex } from "viem";
import { confidentialCoverageManagerAbi } from "@reineira-os/x402-shared";
import { encryptAddress, encryptUint64, type ConfidentialClient } from "./confidential.js";
import type { ConfidentialViem } from "./confidential-escrow.js";

export type PurchaseConfidentialCoverageParams = {
  coverageManager: `0x${string}`;
  pool: `0x${string}`;
  policy: `0x${string}`;
  escrowId: bigint;
  holder: `0x${string}`;
  amount: bigint;
  expiry: bigint;
  riskProof?: Hex;
};

export async function purchaseConfidentialCoverage(
  fhe: ConfidentialClient,
  viem: ConfidentialViem,
  params: PurchaseConfidentialCoverageParams,
): Promise<{ coverageId: bigint; txHash: `0x${string}` }> {
  const encryptedHolder = await encryptAddress(fhe, params.holder);
  const encryptedAmount = await encryptUint64(fhe, params.amount);
  const policyData = encodeAbiParameters([{ type: "uint256" }], [params.escrowId]);

  const { request } = await viem.publicClient.simulateContract({
    account: viem.walletClient.account!,
    address: params.coverageManager,
    abi: confidentialCoverageManagerAbi,
    functionName: "purchaseCoverage",
    args: [
      encryptedHolder,
      params.pool,
      params.policy,
      params.escrowId,
      encryptedAmount,
      params.expiry,
      policyData,
      params.riskProof ?? "0x",
    ],
  });
  const txHash = await viem.walletClient.writeContract(request);
  const receipt = await viem.publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`purchaseCoverage reverted in ${txHash}`);
  }

  const purchased = parseEventLogs({
    abi: confidentialCoverageManagerAbi,
    eventName: "CoveragePurchased",
    logs: receipt.logs,
  }).find((entry) => getAddress(entry.address) === getAddress(params.coverageManager));
  if (purchased) {
    return { coverageId: purchased.args.coverageId, txHash };
  }

  const ids = (await viem.publicClient.readContract({
    address: params.coverageManager,
    abi: confidentialCoverageManagerAbi,
    functionName: "getCoveragesForEscrow",
    args: [params.escrowId],
  })) as readonly bigint[];
  if (ids.length === 0) {
    throw new Error(`could not determine coverageId from ${txHash}`);
  }
  return { coverageId: ids[ids.length - 1]!, txHash };
}

export async function disputeConfidentialCoverage(
  viem: ConfidentialViem,
  params: { coverageManager: `0x${string}`; coverageId: bigint; disputeProof?: Hex },
): Promise<`0x${string}`> {
  const { request } = await viem.publicClient.simulateContract({
    account: viem.walletClient.account!,
    address: params.coverageManager,
    abi: confidentialCoverageManagerAbi,
    functionName: "dispute",
    args: [params.coverageId, params.disputeProof ?? "0x"],
  });
  const txHash = await viem.walletClient.writeContract(request);
  const receipt = await viem.publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`dispute reverted in ${txHash}`);
  }
  return txHash;
}

export async function getCoverageStatus(
  viem: ConfidentialViem,
  params: { coverageManager: `0x${string}`; coverageId: bigint },
): Promise<number> {
  const status = await viem.publicClient.readContract({
    address: params.coverageManager,
    abi: confidentialCoverageManagerAbi,
    functionName: "coverageStatus",
    args: [params.coverageId],
  });
  return Number(status);
}

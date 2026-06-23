import { toHex, type Hex } from "viem";
import { createConfidentialEscrow, readConfidentialAmount } from "@reineira-os/x402-core";
import { confidentialEscrowAbi } from "@reineira-os/x402-rss-shared";
import type { IssuedEscrow } from "./sellerEscrow";
import {
  getConfidentialConfig,
  sellerFheClient,
  confidentialClients,
  type ConfidentialConfig,
} from "./confidentialConfig";

export { getConfidentialConfig };

function randomSalt(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function createConfidentialEscrowForSale(
  cfg: ConfidentialConfig,
  amountAtomic: bigint,
  deadlineSecondsOverride?: number,
): Promise<IssuedEscrow> {
  const { fhe, publicClient, walletClient } = await sellerFheClient(cfg);
  const deadlineSeconds = deadlineSecondsOverride ?? Number(process.env.ESCROW_DEADLINE_SECONDS ?? "900");
  const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;
  const resolverData = "0x" as const;
  const { escrowId, txHash } = await createConfidentialEscrow(fhe, { publicClient, walletClient }, {
    escrow: cfg.escrow,
    owner: cfg.sellerAddress,
    amount: amountAtomic,
    resolver: cfg.resolver,
    resolverData,
  });
  return {
    extra: {
      escrowId: escrowId.toString(),
      salt: randomSalt(),
      receiver: cfg.receiver,
      escrow: cfg.escrow,
    },
    deadline,
    txHash,
  };
}

export async function confidentialRedeem(cfg: ConfidentialConfig, escrowId: bigint): Promise<`0x${string}`> {
  const { publicClient, walletClient } = await sellerFheClient(cfg);
  const { request } = await publicClient.simulateContract({
    account: walletClient.account!,
    address: cfg.escrow,
    abi: confidentialEscrowAbi,
    functionName: "redeem",
    args: [escrowId],
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("confidential redeem reverted");
  return hash;
}

export async function revealEscrowAmount(cfg: ConfidentialConfig, escrowId: bigint): Promise<bigint> {
  const { fhe, publicClient, walletClient } = await sellerFheClient(cfg);
  return readConfidentialAmount(fhe, { publicClient, walletClient }, { escrow: cfg.escrow, escrowId });
}

export function readConfidentialAmountHandle(cfg: ConfidentialConfig) {
  const { publicClient } = confidentialClients(cfg);
  return async (escrowId: bigint): Promise<bigint> =>
    (await publicClient.readContract({
      address: cfg.escrow,
      abi: confidentialEscrowAbi,
      functionName: "getAmount",
      args: [escrowId],
    })) as bigint;
}

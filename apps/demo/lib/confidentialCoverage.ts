import {
  purchaseConfidentialCoverage,
  disputeConfidentialCoverage,
  getCoverageStatus,
} from "@reineira-os/x402-core";
import { sellerFheClient, confidentialClients, type ConfidentialConfig } from "./confidentialConfig";

export interface ConfidentialCoverageResult {
  status: "attached";
  coverageId: string;
  tx: `0x${string}`;
  pool: `0x${string}`;
  policy: `0x${string}`;
  holder: `0x${string}`;
  expiry: number;
  amountAtomic: string;
}

export async function attachConfidentialCoverage(
  cfg: ConfidentialConfig,
  args: { escrowId: string; amountAtomic: string; expiry: number; holder: `0x${string}` },
): Promise<ConfidentialCoverageResult> {
  const { fhe, publicClient, walletClient } = await sellerFheClient(cfg);
  const chainNow = Number(((await publicClient.getBlock()).timestamp));
  const expiry = BigInt(Math.max(args.expiry, chainNow + 120));
  const { coverageId, txHash } = await purchaseConfidentialCoverage(fhe, { publicClient, walletClient }, {
    coverageManager: cfg.coverageManager,
    pool: cfg.pool,
    policy: cfg.policy,
    escrowId: BigInt(args.escrowId),
    holder: args.holder,
    amount: BigInt(args.amountAtomic),
    expiry,
  });
  return {
    status: "attached",
    coverageId: coverageId.toString(),
    tx: txHash,
    pool: cfg.pool,
    policy: cfg.policy,
    holder: args.holder,
    expiry: Number(expiry),
    amountAtomic: args.amountAtomic,
  };
}

export async function disputeConfidentialCoverageClaim(
  cfg: ConfidentialConfig,
  coverageId: bigint,
): Promise<{ tx: `0x${string}`; status: number }> {
  const { publicClient, walletClient } = confidentialClients(cfg);
  const tx = await disputeConfidentialCoverage({ publicClient, walletClient }, {
    coverageManager: cfg.coverageManager,
    coverageId,
  });
  const status = await getCoverageStatus({ publicClient, walletClient }, {
    coverageManager: cfg.coverageManager,
    coverageId,
  });
  return { tx, status };
}

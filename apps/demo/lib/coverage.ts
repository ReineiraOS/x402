import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  type Hex,
  type PublicClient,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ARBITRUM_SEPOLIA } from "@reineira-os/x402-rss-shared";
import { getSellerEscrowConfig } from "./sellerEscrow";

export const coverageManagerAbi = [
  {
    type: "function",
    name: "purchaseCoverage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "holder", type: "address" },
      { name: "pool", type: "address" },
      { name: "policy", type: "address" },
      { name: "escrowId", type: "uint256" },
      { name: "coverageAmount", type: "uint256" },
      { name: "coverageExpiry", type: "uint256" },
      { name: "policyData", type: "bytes" },
      { name: "riskProof", type: "bytes" },
    ],
    outputs: [{ name: "coverageId", type: "uint256" }],
  },
  {
    type: "function",
    name: "dispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "coverageId", type: "uint256" },
      { name: "disputeProof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "coverageStatus",
    stateMutability: "view",
    inputs: [{ name: "coverageId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "event",
    name: "CoveragePurchased",
    inputs: [{ name: "coverageId", type: "uint256", indexed: true }],
  },
  { type: "error", name: "NotInsuranceManager", inputs: [] },
  { type: "error", name: "InvalidPolicy", inputs: [] },
  { type: "error", name: "EscrowAlreadyCovered", inputs: [] },
] as const;

export const deliveryResolverAbi = [
  {
    type: "function",
    name: "attestDelivery",
    stateMutability: "nonpayable",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "isDelivered",
    stateMutability: "view",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isBreached",
    stateMutability: "view",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isConfigured",
    stateMutability: "view",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "deadlineOf",
    stateMutability: "view",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

export const insurancePoolAbi = [
  {
    type: "function",
    name: "isPolicy",
    stateMutability: "view",
    inputs: [{ name: "policy", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "totalLiquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// EIP-1967-independent: the legacy plain Escrow keeps its insurance manager in
// storage slot 2; there is no public getter in the deployed revision.
const ESCROW_INSURANCE_MANAGER_SLOT = 2n;

export interface CoverageConfig {
  coverageManager: `0x${string}`;
  policy: `0x${string}`;
  resolver: `0x${string}`;
  pool: `0x${string}`;
  usdc: `0x${string}`;
  escrow: `0x${string}`;
  sellerKey: Hex;
  sellerAddress: `0x${string}`;
  rpcUrl: string;
}

export function getCoverageConfig(): CoverageConfig | null {
  const seller = getSellerEscrowConfig();
  const coverageManager = process.env.COVERAGE_MANAGER_ADDRESS;
  const policy = process.env.DELIVERY_POLICY_ADDRESS;
  const resolver = process.env.DELIVERY_DEADLINE_RESOLVER_ADDRESS;
  const pool = process.env.COVERAGE_POOL_ADDRESS;
  if (!seller || !coverageManager || !policy || !resolver || !pool) {
    return null;
  }
  return {
    coverageManager: getAddress(coverageManager),
    policy: getAddress(policy),
    resolver: getAddress(resolver),
    pool: getAddress(pool),
    usdc: getAddress(ARBITRUM_SEPOLIA.usdc),
    escrow: seller.escrow,
    sellerKey: seller.sellerKey,
    sellerAddress: seller.sellerAddress,
    rpcUrl: seller.rpcUrl,
  };
}

function publicClientFor(cfg: CoverageConfig): PublicClient {
  return createPublicClient({ chain: arbitrumSepolia, transport: http(cfg.rpcUrl) });
}

export interface CoverageReadiness {
  ready: boolean;
  policyRegistered: boolean;
  insuranceManagerSet: boolean;
  poolLiquidityAtomic: string;
  reasons: string[];
}

// Deterministic precheck so we never fire a doomed purchaseCoverage tx before the
// one-time protocol-owner setup (escrow.setInsuranceManager + registry.registerPolicy
// + pool.addPolicy) has landed. Both gates are read straight from chain.
export async function coverageReadiness(): Promise<CoverageReadiness | null> {
  const cfg = getCoverageConfig();
  if (!cfg) return null;
  const publicClient = publicClientFor(cfg);

  const [policyRegistered, slot, liquidity] = await Promise.all([
    publicClient.readContract({
      address: cfg.pool,
      abi: insurancePoolAbi,
      functionName: "isPolicy",
      args: [cfg.policy],
    }) as Promise<boolean>,
    publicClient.getStorageAt({
      address: cfg.escrow,
      slot: `0x${ESCROW_INSURANCE_MANAGER_SLOT.toString(16)}`,
    }),
    publicClient
      .readContract({ address: cfg.pool, abi: insurancePoolAbi, functionName: "totalLiquidity" })
      .catch(() => 0n) as Promise<bigint>,
  ]);

  const insuranceManager = slot ? getAddress(`0x${slot.slice(-40)}`) : null;
  const insuranceManagerSet = insuranceManager === cfg.coverageManager;

  const reasons: string[] = [];
  if (!policyRegistered)
    reasons.push("DeliveryPolicy is not yet allow-listed on the pool (registerPolicy + addPolicy)");
  if (!insuranceManagerSet)
    reasons.push("escrow.setInsuranceManager(CoverageManager) has not been called");

  return {
    ready: policyRegistered && insuranceManagerSet,
    policyRegistered,
    insuranceManagerSet,
    poolLiquidityAtomic: liquidity.toString(),
    reasons,
  };
}

export interface CoverageAttachResult {
  status: "active" | "pending-setup" | "failed";
  coverageId: string | null;
  tx: string | null;
  pool: `0x${string}`;
  policy: `0x${string}`;
  holder: `0x${string}`;
  expiry: number;
  amountAtomic: string;
  note: string | null;
}

// Buy real coverage on the live CoverageManager against the just-funded escrow.
// DeliveryPolicy charges zero premium, so no tokens move at purchase; the coverage
// binds to the DeliveryDeadlineResolver as its breach oracle for this escrow.
export async function attachCoverage(args: {
  escrowId: string;
  amountAtomic: string;
  expiry: number;
  holder: `0x${string}`;
}): Promise<CoverageAttachResult> {
  const cfg = getCoverageConfig();
  const base = {
    coverageId: null,
    tx: null,
    pool: cfg?.pool ?? ("0x" as `0x${string}`),
    policy: cfg?.policy ?? ("0x" as `0x${string}`),
    holder: args.holder,
    expiry: args.expiry,
    amountAtomic: args.amountAtomic,
  };
  if (!cfg) {
    return { ...base, status: "failed", note: "coverage is not configured on the server" };
  }

  const readiness = await coverageReadiness();
  if (readiness && !readiness.ready) {
    return {
      ...base,
      status: "pending-setup",
      note: `coverage purchase pending one-time setup — ${readiness.reasons.join("; ")}`,
    };
  }

  const publicClient = publicClientFor(cfg);
  const seller = privateKeyToAccount(cfg.sellerKey);
  const walletClient = createWalletClient({
    account: seller,
    chain: arbitrumSepolia,
    transport: http(cfg.rpcUrl),
  });

  const escrowId = BigInt(args.escrowId);
  // Coverage expiry must be strictly greater than block.timestamp; clamp to the chain
  // clock (which can lead wall-clock) plus a margin so a short escrow window is safe.
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const chainNow = Number(block.timestamp);
  const expiry = BigInt(Math.max(args.expiry, chainNow + 120));
  const policyData = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [cfg.resolver, escrowId],
  );

  try {
    const { result, request } = await publicClient.simulateContract({
      account: seller,
      address: cfg.coverageManager,
      abi: coverageManagerAbi,
      functionName: "purchaseCoverage",
      args: [
        args.holder,
        cfg.pool,
        cfg.policy,
        escrowId,
        BigInt(args.amountAtomic),
        expiry,
        policyData,
        "0x",
      ],
    });
    const tx = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") {
      return { ...base, status: "failed", tx, note: `coverage purchase reverted in ${tx}` };
    }
    return {
      ...base,
      status: "active",
      coverageId: (result as bigint).toString(),
      tx,
      expiry: Number(expiry),
      note: null,
    };
  } catch (error) {
    return {
      ...base,
      status: "failed",
      note: `coverage purchase failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    };
  }
}

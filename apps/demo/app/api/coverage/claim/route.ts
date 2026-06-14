import { NextResponse } from "next/server";
import { createPublicClient, encodeFunctionData, getAddress, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import {
  coverageManagerAbi,
  deliveryResolverAbi,
  getCoverageConfig,
} from "../../../../lib/coverage";
import { sendFromTreasury } from "../../../../lib/sessionWallet";
import { getSpendByEscrowId, markSpendClaimed } from "../../../../lib/agentStore";

export const dynamic = "force-dynamic";

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// File an insurance claim on a covered purchase whose delivery was breached. The
// dispute originates from the buyer's treasury (the coverage holder), so a valid
// breach pays USDC from the underwriter pool straight back to the treasury.
export async function POST(request: Request) {
  const cfg = getCoverageConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "coverage mode is not configured (see .env.example)" },
      { status: 400 },
    );
  }

  let body: { escrowId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.escrowId) {
    return NextResponse.json({ error: "escrowId is required" }, { status: 400 });
  }

  const record = await getSpendByEscrowId(body.escrowId);
  const coverage = record?.coverage;
  if (!coverage || !coverage.coverageId) {
    return NextResponse.json(
      { error: "no coverage on this purchase" },
      { status: 400 },
    );
  }
  if (coverage.status !== "active") {
    return NextResponse.json(
      { error: `coverage is ${coverage.status}, not claimable` },
      { status: 400 },
    );
  }
  if (coverage.claimed) {
    return NextResponse.json(
      { error: "coverage already claimed", txHash: coverage.claimTx },
      { status: 409 },
    );
  }

  const treasury = getAddress(coverage.holder);
  const coverageId = BigInt(coverage.coverageId);
  const escrowId = BigInt(body.escrowId);

  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(cfg.rpcUrl),
  });

  // The policy only pays on a real breach: the seller never attested delivery before
  // the deadline. Read it straight from the resolver so we return a clean error instead
  // of a reverted on-chain dispute.
  const breached = (await publicClient.readContract({
    address: cfg.resolver,
    abi: deliveryResolverAbi,
    functionName: "isBreached",
    args: [escrowId],
  })) as boolean;
  if (!breached) {
    return NextResponse.json(
      {
        error: "not a breach",
        detail:
          "delivery is not breached — either the seller attested in time, or the deadline has not passed yet.",
      },
      { status: 409 },
    );
  }

  const balanceBefore = (await publicClient.readContract({
    address: cfg.usdc,
    abi: erc20BalanceAbi,
    functionName: "balanceOf",
    args: [treasury],
  })) as bigint;

  const data = encodeFunctionData({
    abi: coverageManagerAbi,
    functionName: "dispute",
    args: [coverageId, "0x"],
  });

  let txHash: `0x${string}`;
  try {
    txHash = await sendFromTreasury(treasury, cfg.coverageManager, data);
  } catch (error) {
    return NextResponse.json(
      {
        error: "claim failed",
        detail: error instanceof Error ? error.message.split("\n")[0] : String(error),
      },
      { status: 502 },
    );
  }

  const balanceAfter = (await publicClient.readContract({
    address: cfg.usdc,
    abi: erc20BalanceAbi,
    functionName: "balanceOf",
    args: [treasury],
  })) as bigint;
  const payoutAtomic = (balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0n).toString();

  await markSpendClaimed(body.escrowId, txHash, payoutAtomic);

  return NextResponse.json({
    txHash,
    payoutAtomic,
    escrowId: body.escrowId,
    arbiscan: `https://sepolia.arbiscan.io/tx/${txHash}`,
  });
}

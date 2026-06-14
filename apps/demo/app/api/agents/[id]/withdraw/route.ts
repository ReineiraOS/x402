import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { getAgent } from "../../../../../lib/agentStore";
import { createAgentWallet } from "../../../../../lib/agentWallet";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  let body: { to?: string; amountAtomic?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let to: `0x${string}`;
  try {
    to = getAddress(body.to ?? "");
  } catch {
    return NextResponse.json(
      { error: "valid destination address `to` is required" },
      { status: 400 },
    );
  }

  let amount: bigint | undefined;
  if (body.amountAtomic !== undefined) {
    if (!/^\d+$/.test(body.amountAtomic) || BigInt(body.amountAtomic) <= 0n) {
      return NextResponse.json(
        { error: "`amountAtomic` must be a positive integer string" },
        { status: 400 },
      );
    }
    amount = BigInt(body.amountAtomic);
  }

  try {
    const wallet = await createAgentWallet(agent.ownerPrivateKey);
    await wallet.deployIfNeeded();
    const { txHash, amount: swept } = await wallet.sweepUsdc(to, amount);
    return NextResponse.json({
      txHash,
      amountAtomic: swept.toString(),
      to,
      arbiscan: `https://sepolia.arbiscan.io/tx/${txHash}`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "withdraw failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

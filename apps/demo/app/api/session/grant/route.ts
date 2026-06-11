import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { saveGrant } from "../../../../lib/sessionStore";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { treasuryAddress?: string; approval?: string; budgetAtomic?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  let treasury: `0x${string}`;
  try {
    treasury = getAddress(body.treasuryAddress ?? "");
  } catch {
    return NextResponse.json({ error: "valid treasuryAddress is required" }, { status: 400 });
  }
  if (typeof body.approval !== "string" || body.approval.length === 0) {
    return NextResponse.json({ error: "approval is required" }, { status: 400 });
  }
  if (typeof body.budgetAtomic !== "string" || !/^\d+$/.test(body.budgetAtomic) || BigInt(body.budgetAtomic) <= 0n) {
    return NextResponse.json({ error: "a positive budget is required" }, { status: 400 });
  }
  const ok = await saveGrant(treasury, body.approval, body.budgetAtomic);
  if (!ok) {
    return NextResponse.json(
      { error: "no session key for this treasury — request one first" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}

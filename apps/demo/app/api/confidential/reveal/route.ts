import { NextResponse } from "next/server";
import { getConfidentialConfig } from "../../../../lib/confidentialConfig";
import { revealEscrowAmount } from "../../../../lib/confidentialEscrow";

export async function POST(request: Request) {
  const body = (await request.json()) as { kind?: string; escrowId?: string };
  const cfg = getConfidentialConfig();
  if (!cfg) return NextResponse.json({ error: "confidential not configured" }, { status: 400 });
  if (body.kind !== "escrow" || !body.escrowId) {
    return NextResponse.json({ error: "unsupported reveal" }, { status: 400 });
  }
  try {
    const atomic = await revealEscrowAmount(cfg, BigInt(body.escrowId));
    return NextResponse.json({ ok: true, amountAtomic: atomic.toString(), usdc: (Number(atomic) / 1e6).toFixed(2) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "decrypt failed" }, { status: 500 });
  }
}

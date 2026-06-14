import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { getSession } from "../../../lib/sessionStore";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  let treasury: `0x${string}`;
  try {
    treasury = getAddress(url.searchParams.get("treasuryAddress") ?? "");
  } catch {
    return NextResponse.json({ error: "valid treasuryAddress is required" }, { status: 400 });
  }
  const session = await getSession(treasury);
  return NextResponse.json({
    granted: !!session?.approval,
    sessionKeyAddress: session?.sessionKeyAddress ?? null,
    budgetAtomic: session?.budgetAtomic ?? null,
    spentAtomic: session?.spentAtomic ?? "0",
  });
}

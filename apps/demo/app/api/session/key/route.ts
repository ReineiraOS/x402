import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { getOrCreateSessionKey } from "../../../../lib/sessionStore";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { treasuryAddress?: string };
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
  const { sessionKeyAddress } = await getOrCreateSessionKey(treasury);
  return NextResponse.json({ sessionKeyAddress });
}

import { NextResponse } from "next/server";
import { readVaultSnapshot } from "../../../../lib/twoKey";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await readVaultSnapshot();
    if (!snapshot) return NextResponse.json({ configured: false });
    return NextResponse.json({ configured: true, ...snapshot });
  } catch (error) {
    return NextResponse.json({
      configured: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

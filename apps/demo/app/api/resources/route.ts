import { NextResponse } from "next/server";
import { RESOURCE_CATALOG } from "../../../lib/resources";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ resources: RESOURCE_CATALOG });
}

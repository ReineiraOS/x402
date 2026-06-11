import { NextResponse } from "next/server";
import { getPluginCatalog } from "../../../lib/pluginCatalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const plugins = await getPluginCatalog();
  return NextResponse.json({ plugins });
}

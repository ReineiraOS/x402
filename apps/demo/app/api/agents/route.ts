import { NextResponse } from "next/server";
import {
  createAgent,
  listAgents,
  toPublicAgent,
  usdcBalanceOf,
} from "../../../lib/agentStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const agents = await listAgents();
  const enriched = await Promise.all(
    agents.map(async (agent) => {
      const pub = toPublicAgent(agent);
      let usdcBalanceAtomic = "0";
      try {
        usdcBalanceAtomic = (await usdcBalanceOf(agent.address)).toString();
      } catch {
        usdcBalanceAtomic = "0";
      }
      return { ...pub, usdcBalanceAtomic };
    }),
  );
  return NextResponse.json({ agents: enriched });
}

export async function POST(request: Request) {
  let body: {
    name?: string;
    prePrompt?: string;
    pluginIds?: string[];
    deadlineSeconds?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const prePrompt = body.prePrompt?.trim() ?? "";
  const pluginIds = Array.isArray(body.pluginIds) ? body.pluginIds : [];
  const deadlineSeconds =
    typeof body.deadlineSeconds === "number" ? body.deadlineSeconds : undefined;

  try {
    const agent = await createAgent({ name, prePrompt, pluginIds, deadlineSeconds });
    return NextResponse.json({ agent: toPublicAgent(agent) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "failed to create agent",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

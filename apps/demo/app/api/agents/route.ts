import { NextResponse } from "next/server";
import { createAgent, listAgents, toPublicAgent, usdcBalanceOf } from "../../../lib/agentStore";

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
  if (name.length > 40) {
    return NextResponse.json({ error: "name must be 40 characters or fewer" }, { status: 400 });
  }
  const prePrompt = body.prePrompt?.trim() ?? "";
  if (prePrompt.length > 300) {
    return NextResponse.json(
      { error: "pre-prompt must be 300 characters or fewer" },
      { status: 400 },
    );
  }
  const pluginIds = Array.isArray(body.pluginIds)
    ? body.pluginIds.filter((p): p is string => typeof p === "string")
    : [];
  let deadlineSeconds: number | undefined;
  if (body.deadlineSeconds !== undefined) {
    const d = body.deadlineSeconds;
    if (typeof d !== "number" || !Number.isFinite(d) || d < 10 || d > 86400) {
      return NextResponse.json(
        { error: "deadlineSeconds must be between 10 and 86400" },
        { status: 400 },
      );
    }
    deadlineSeconds = Math.floor(d);
  }

  try {
    const agent = await createAgent({ name, prePrompt, pluginIds, deadlineSeconds });
    return NextResponse.json({ agent: toPublicAgent(agent) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "failed to create agent wallet",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

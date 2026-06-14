import { NextResponse } from "next/server";
import {
  deleteAgent,
  getAgent,
  toPublicAgent,
  updateAgent,
  usdcBalanceOf,
} from "../../../../lib/agentStore";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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

  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    if (trimmed.length > 40) {
      return NextResponse.json({ error: "name must be 40 characters or fewer" }, { status: 400 });
    }
  }
  if (typeof body.prePrompt === "string" && body.prePrompt.trim().length > 300) {
    return NextResponse.json(
      { error: "pre-prompt must be 300 characters or fewer" },
      { status: 400 },
    );
  }
  if (body.deadlineSeconds !== undefined) {
    const d = body.deadlineSeconds;
    if (typeof d !== "number" || !Number.isFinite(d) || d < 10 || d > 86400) {
      return NextResponse.json(
        { error: "deadlineSeconds must be between 10 and 86400" },
        { status: 400 },
      );
    }
  }

  const updated = await updateAgent(id, {
    name: body.name,
    prePrompt: body.prePrompt,
    pluginIds: Array.isArray(body.pluginIds) ? body.pluginIds : undefined,
    deadlineSeconds: typeof body.deadlineSeconds === "number" ? body.deadlineSeconds : undefined,
  });
  if (!updated) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }

  const pub = toPublicAgent(updated);
  let usdcBalanceAtomic = "0";
  try {
    usdcBalanceAtomic = (await usdcBalanceOf(updated.address)).toString();
  } catch {
    usdcBalanceAtomic = "0";
  }
  return NextResponse.json({ agent: { ...pub, usdcBalanceAtomic } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const removed = await deleteAgent(id);
  if (!removed) {
    return NextResponse.json(
      { error: "cannot delete this agent (not found or default)" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) {
    return NextResponse.json({ error: "agent not found" }, { status: 404 });
  }
  const pub = toPublicAgent(agent);
  let usdcBalanceAtomic = "0";
  try {
    usdcBalanceAtomic = (await usdcBalanceOf(agent.address)).toString();
  } catch {
    usdcBalanceAtomic = "0";
  }
  return NextResponse.json({ agent: { ...pub, usdcBalanceAtomic } });
}

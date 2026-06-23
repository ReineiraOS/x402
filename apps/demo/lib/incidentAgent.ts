import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { isSeverity, type Severity } from "@reineira-os/x402-shared";
import type { IncidentReport } from "./incidentReports";

type RunEvent = Record<string, unknown>;
type Emit = (event: RunEvent) => void;

const MODEL = "claude-haiku-4-5-20251001";

const CLASSIFY_TOOL: Tool = {
  name: "classify_incident",
  description:
    "Record your triage of the vulnerability report: its severity, and whether to HALT the " +
    "monitored contract now or keep MONITORING. Call this once you have decided.",
  input_schema: {
    type: "object",
    properties: {
      severity: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
        description: "Your assessed severity of the reported issue.",
      },
      decision: {
        type: "string",
        enum: ["halt", "monitor"],
        description:
          "halt = freeze the contract now (you stake a bond on this call being right); " +
          "monitor = take no freezing action.",
      },
      rationale: {
        type: "string",
        description: "One crisp sentence justifying the call, in your own voice.",
      },
    },
    required: ["severity", "decision", "rationale"],
  },
};

const PERSONA =
  "You are the Reineira Incident Desk — an autonomous incident-manager agent guarding on-chain " +
  "contracts. You weigh credibility (source, PoC, specificity) against blast radius. A wrong " +
  "freeze forfeits your staked bond; missing a real exploit lets funds drain. You are decisive but " +
  "skeptical of unsourced panic.";

const SYSTEM =
  `${PERSONA}\n\n` +
  `You will be given a single vulnerability report. Think out loud very briefly (one or two ` +
  `sentences) weighing its credibility and blast radius, then call classify_incident. Keep it ` +
  `terse; this is a live demo.`;

function reportMessage(report: IncidentReport): string {
  return (
    `Vulnerability report:\n` +
    `Source: ${report.source}\n` +
    `Affected contract: ${report.affectedContract}\n` +
    `Title: ${report.title}\n` +
    `Body: ${report.body}\n\n` +
    `Triage it and act.`
  );
}

export interface IncidentDecision {
  severity: Severity;
  decision: "halt" | "monitor";
  rationale: string;
}

export async function runIncidentAgent(args: {
  report: IncidentReport;
  emit: Emit;
  apiKey: string | undefined;
}): Promise<IncidentDecision> {
  const { report, emit, apiKey } = args;

  const fallback = (): IncidentDecision => ({
    severity: report.severity,
    decision: report.severity === "high" || report.severity === "critical" ? "halt" : "monitor",
    rationale: "No model key — deterministic triage from the report's claimed severity.",
  });

  if (!apiKey) {
    const d = fallback();
    emit({ zone: "incident", kind: "thinking", msg: d.rationale });
    return d;
  }

  const anthropic = new Anthropic({ apiKey });
  const messages: MessageParam[] = [{ role: "user", content: reportMessage(report) }];

  const modelStream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM,
    tools: [CLASSIFY_TOOL],
    messages,
  });

  let textBuffer = "";
  modelStream.on("text", (delta) => {
    textBuffer += delta;
    emit({ zone: "incident", kind: "thinking", msg: delta, stream: true, final: false });
  });

  const finalMessage = await modelStream.finalMessage();
  if (textBuffer.length > 0) emit({ zone: "incident", kind: "thinking", streamEnd: true });

  let toolUse = finalMessage.content.find(
    (block): block is ToolUseBlock =>
      block.type === "tool_use" && block.name === "classify_incident",
  );
  if (!toolUse) {
    const forced = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM,
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: "classify_incident" },
      messages: [
        ...messages,
        {
          role: "assistant",
          content: textBuffer.trim().length > 0 ? textBuffer : "Assessing the report.",
        },
        { role: "user", content: "Record your classification now by calling classify_incident." },
      ],
    });
    toolUse = forced.content.find(
      (block): block is ToolUseBlock =>
        block.type === "tool_use" && block.name === "classify_incident",
    );
  }
  if (!toolUse) {
    const d = fallback();
    emit({
      zone: "incident",
      kind: "thinking",
      msg: `No tool call — defaulting to ${d.decision}.`,
    });
    return d;
  }

  const input = toolUse.input as { severity?: unknown; decision?: unknown; rationale?: unknown };
  const severity: Severity = isSeverity(input.severity) ? input.severity : "low";
  const decision: "halt" | "monitor" = input.decision === "halt" ? "halt" : "monitor";
  const rationale =
    typeof input.rationale === "string" && input.rationale.trim().length > 0
      ? input.rationale.trim()
      : "(no rationale given)";
  return { severity, decision, rationale };
}

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import type { ResourceDef } from "./resources";

type RunEvent = Record<string, unknown>;
type Emit = (event: RunEvent) => void;

const MODEL = "claude-haiku-4-5-20251001";

const DELIVER_TOOL: Tool = {
  name: "deliver_report",
  description:
    "Fulfill the buyer's data order by delivering your composed market read. Call this when " +
    "you choose to fulfill. After this you attest delivery on-chain and the escrow releases your payment.",
  input_schema: {
    type: "object",
    properties: {
      report: {
        type: "string",
        description:
          "The market read you deliver to the buyer — one or two crisp lines composed from the real " +
          "on-chain numbers you were given, in your own voice as the data desk.",
      },
    },
    required: ["report"],
  },
};

export interface SellerOutcome {
  delivered: boolean;
  report: string | null;
}

const SELLER_PERSONA =
  "You are the Reineira Data Desk — an autonomous selling agent that fulfills on-chain data orders. " +
  "You take pride in fast, accurate reads and only deliver data you can stand behind.";

function buildSellerPrompt(resource: ResourceDef, data: string): string {
  const price = (Number(resource.priceAtomic) / 1e6).toFixed(2);
  return (
    `${SELLER_PERSONA}\n\n` +
    `A buyer paid about ${price} USDC into a plugin-gated escrow for: "${resource.task}"\n` +
    `The payment is held — you are paid only once you attest delivery on-chain.\n` +
    `Fresh on-chain data you have to work with:\n${data}\n\n` +
    `Think out loud very briefly (one sentence, in your own voice), then call deliver_report with a crisp ` +
    `read composed from these exact numbers. Keep it terse; this is a live demo.`
  );
}

// The seller agent: reasons over the real on-chain numbers and either delivers a composed
// read (the caller then attests on-chain) or, when forced, declines (the escrow breaches at
// its deadline and the buyer claims). Streams its reasoning to the "seller" zone.
export async function runSellerAgent(args: {
  resource: ResourceDef;
  artifact: Record<string, unknown>;
  emit: Emit;
  apiKey: string | undefined;
  forceDecline: boolean;
}): Promise<SellerOutcome> {
  const { resource, artifact, emit, apiKey, forceDecline } = args;
  const dataLine =
    typeof artifact.result === "string" ? artifact.result : JSON.stringify(artifact);

  if (forceDecline) {
    emit({
      zone: "seller",
      msg: "Reviews the order and declines to deliver — the buyer's funds stay locked in escrow until the deadline.",
    });
    return { delivered: false, report: null };
  }

  if (!apiKey) {
    // No LLM key: deliver the raw feed as the read so the on-chain flow stays demoable.
    emit({ zone: "seller", msg: `Delivers the read: ${dataLine}` });
    return { delivered: true, report: dataLine };
  }

  const anthropic = new Anthropic({ apiKey });
  const messages: MessageParam[] = [
    { role: "user", content: "A new data order just settled into escrow. Decide and act." },
  ];

  const modelStream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 400,
    system: buildSellerPrompt(resource, dataLine),
    tools: [DELIVER_TOOL],
    messages,
  });

  let textBuffer = "";
  modelStream.on("text", (delta) => {
    textBuffer += delta;
    emit({ zone: "seller", msg: delta, stream: true, final: false });
  });

  const finalMessage = await modelStream.finalMessage();
  if (textBuffer.length > 0) emit({ zone: "seller", streamEnd: true });

  const toolUse = finalMessage.content.find(
    (block): block is ToolUseBlock => block.type === "tool_use" && block.name === "deliver_report",
  );
  if (!toolUse) {
    emit({ zone: "seller", msg: "Declines to deliver this order — funds stay in escrow." });
    return { delivered: false, report: null };
  }

  const report = ((toolUse.input as { report?: string }).report ?? "").trim() || dataLine;
  return { delivered: true, report };
}

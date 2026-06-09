import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@reineira-os/x402-core/http";
import { ExactEvmScheme, toClientEvmSigner } from "@reineira-os/x402-core/exact/client";
import type { PaymentPayload, PaymentRequired } from "@reineira-os/x402-core/types";

export const dynamic = "force-dynamic";

type RunEvent = Record<string, unknown>;
type Emit = (event: RunEvent) => void;

// Cosmetic pacing between narration steps so the "theater" is readable.
// The settlement itself is real and on-chain; these delays only slow the storytelling.
const STEP_MS = 850;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MODEL = "claude-haiku-4-5-20251001";
const AGENT_BUDGET_USDC = "1.00";
const AGENT_GOAL =
  "Give a one-line read on current ETH market conditions, grounded in fresh on-chain + price data.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resourceUrl(request: Request): string {
  try {
    const url = new URL(request.url);
    return `${url.origin}/api/resource`;
  } catch {
    return "http://localhost:3000/api/resource";
  }
}

function formatUsdc(atomic: string): string {
  const value = Number(atomic) / 1e6;
  return `${value.toFixed(2)} USDC`;
}

function networkLabel(caip: string): string {
  return caip === "eip155:421614" ? "Arbitrum Sepolia" : caip;
}

type LiveReport = { result?: string } & Record<string, unknown>;

// The REAL x402 deal: GET → 402 → sign EIP-3009 → re-GET with payment → on-chain
// settle via the facilitator → live report. Emits the same system/provider/deal/tx
// events the demo has always emitted, and returns the freshly-fetched artifact so
// the agent reasons over real data (never a faked tool result).
async function runX402Payment(resource: string, emit: Emit): Promise<LiveReport> {
  const buyerKey = process.env.BUYER_PRIVATE_KEY;
  if (!buyerKey) {
    throw new Error("BUYER_PRIVATE_KEY is not set");
  }
  const account = privateKeyToAccount(buyerKey as `0x${string}`);
  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(process.env.ARBITRUM_SEPOLIA_RPC_URL),
  });

  const unpaid = await fetch(resource, { headers: { accept: "application/json" } });
  if (unpaid.status !== 402) {
    throw new Error(`expected 402 from resource, got ${unpaid.status}`);
  }
  const paymentRequiredHeader = unpaid.headers.get("payment-required");
  if (!paymentRequiredHeader) {
    throw new Error("missing payment-required header on 402");
  }
  const paymentRequired: PaymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
  const requirements = paymentRequired.accepts[0];
  if (!requirements) {
    throw new Error("no payment requirements offered");
  }

  const price = formatUsdc(requirements.amount);
  const network = networkLabel(requirements.network);
  emit({
    kind: "deal",
    deal: paymentRequired.resource?.description ?? "x402 resource",
    price,
    network,
  });
  await sleep(STEP_MS);
  emit({
    zone: "system",
    msg: `402 Payment Required — provider asks ${price} for the call`,
  });
  await sleep(STEP_MS);

  const scheme = new ExactEvmScheme(toClientEvmSigner(account, publicClient));
  const partial = await scheme.createPaymentPayload(paymentRequired.x402Version, requirements);
  const payment: PaymentPayload = {
    x402Version: partial.x402Version,
    resource: paymentRequired.resource,
    accepted: requirements,
    payload: partial.payload as unknown as Record<string, unknown>,
    extensions: paymentRequired.extensions,
  };
  emit({ zone: "buyer", msg: "Signs the payment — EIP-3009, no gas, no wallet popup" });
  await sleep(STEP_MS);

  emit({
    zone: "system",
    msg: "Facilitator verifies the signature, then settles on Arbitrum (pays gas for the buyer)…",
  });
  const paid = await fetch(resource, {
    headers: {
      accept: "application/json",
      "payment-signature": encodePaymentSignatureHeader(payment),
    },
  });
  const paidBody = (await paid.json()) as {
    error?: string;
    artifact?: LiveReport;
    settlement?: { transaction?: string; payer?: string; network?: string; verified?: boolean };
  };

  if (paid.status !== 200) {
    throw new Error(paidBody.error ?? `resource returned ${paid.status}`);
  }

  const tx = paidBody.settlement?.transaction;
  await sleep(STEP_MS);
  emit({
    zone: "system",
    msg: "Paid ✓ — USDC moved Buyer → Provider",
    tx,
    arbiscan: tx ? `https://sepolia.arbiscan.io/tx/${tx}` : undefined,
  });
  await sleep(STEP_MS);
  emit({
    zone: "provider",
    msg: "Delivers the live data report",
    detail: paidBody.artifact?.result,
    artifact: paidBody.artifact,
  });

  return paidBody.artifact ?? {};
}

const FETCH_LIVE_REPORT_TOOL: Tool = {
  name: "fetch_live_report",
  description:
    "Buy a live on-chain + ETH-price report for ~0.10 USDC via x402. " +
    "Pays autonomously over EIP-3009 (no gas, no popup) and returns a freshly-fetched " +
    "Arbitrum Sepolia block + gas + ETH/USD spot price. Call this when you need current " +
    "market data you do not already have.",
  input_schema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Why you need to buy this report right now (one short sentence).",
      },
    },
    required: ["reason"],
  },
};

const SYSTEM_PROMPT =
  `You are an autonomous buying agent operating with a budget of ${AGENT_BUDGET_USDC} USDC.\n` +
  `Your task: ${AGENT_GOAL}\n\n` +
  "You have one tool, fetch_live_report, which buys a live on-chain + ETH-price report " +
  "for about 0.10 USDC. You do not have current data, so to do the task well you must " +
  "decide to buy the report. Think out loud briefly (one or two short sentences) about " +
  "the decision before you call the tool. After the report arrives, give a single crisp " +
  "one-line read on current ETH market conditions that cites the concrete numbers you paid for. " +
  "Keep all output terse; this is a live demo.";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const resource = resourceUrl(request);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          emit({
            zone: "system",
            level: "error",
            msg: "ANTHROPIC_API_KEY is not set — add it to apps/demo/.env.local to run the agent.",
          });
          return;
        }

        const anthropic = new Anthropic({ apiKey });
        const messages: MessageParam[] = [
          {
            role: "user",
            content:
              "Begin. Decide whether you need fresh market data for the task, then act.",
          },
        ];

        let paid = false;

        // Agent loop: stream reasoning to the Buyer zone, run the real x402 payment
        // when the model calls the tool, feed the real artifact back, then stream the
        // model's final grounded answer. Capped to keep the demo bounded.
        for (let turn = 0; turn < 4; turn += 1) {
          const isFinalTurn = paid;

          const modelStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 600,
            system: SYSTEM_PROMPT,
            tools: [FETCH_LIVE_REPORT_TOOL],
            messages,
          });

          let textBuffer = "";
          modelStream.on("text", (delta) => {
            textBuffer += delta;
            emit({ zone: "buyer", msg: delta, stream: true, final: isFinalTurn });
          });

          const finalMessage = await modelStream.finalMessage();

          if (textBuffer.length > 0) {
            // Close the streamed line so the client can finalize it cleanly.
            emit({ zone: "buyer", streamEnd: true, final: isFinalTurn });
          }

          const toolUses = finalMessage.content.filter(
            (block): block is ToolUseBlock => block.type === "tool_use",
          );

          if (toolUses.length === 0) {
            // No tool call: the model produced its (final) answer — we are done.
            emit({ done: true });
            return;
          }

          messages.push({ role: "assistant", content: finalMessage.content });

          const toolResults: MessageParam["content"] = [];
          for (const toolUse of toolUses) {
            if (toolUse.name !== "fetch_live_report") {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `Unknown tool: ${toolUse.name}`,
                is_error: true,
              });
              continue;
            }

            emit({ zone: "buyer", msg: "Decides to buy the live report — initiating x402 payment" });
            await sleep(STEP_MS);

            const report = await runX402Payment(resource, emit);
            paid = true;

            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify(report),
            });
          }

          messages.push({ role: "user", content: toolResults });
        }

        // Safety net: loop exhausted without a final text-only turn.
        emit({ done: true });
      } catch (error) {
        emit({ zone: "system", level: "error", msg: errorMessage(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

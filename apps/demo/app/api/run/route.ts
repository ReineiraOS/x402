import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@reineira-os/x402-core/http";
import {
  ExactEvmScheme,
  toClientEvmSigner,
  type ClientEvmSigner,
} from "@reineira-os/x402-core/exact/client";
import { getEscrowExtra } from "@reineira-os/x402-core/exact/escrow";
import type { PaymentPayload, PaymentRequired } from "@reineira-os/x402-core/types";
import { createAgentWallet } from "../../../lib/agentWallet";
import {
  getAgent,
  recordSpend,
  markSpendCovered,
  markSpendDelivered,
  updateSpendTranscript,
  type AgentRecord,
  type TranscriptLine,
} from "../../../lib/agentStore";
import { getResource, type ResourceDef } from "../../../lib/resources";
import { getTreasurySigner, ensureTreasuryDeployed } from "../../../lib/sessionWallet";
import { addSpent, getSession } from "../../../lib/sessionStore";
import { attachCoverage } from "../../../lib/coverage";
import { attestAndRedeem, getSellerEscrowConfig } from "../../../lib/sellerEscrow";
import { runSellerAgent } from "../../../lib/sellerAgent";
import { runTwoKeyHalt } from "../../../lib/twoKey";

const COVERAGE_PLUGIN_ID = "delivery-coverage-policy";

export const dynamic = "force-dynamic";

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

type RunEvent = Record<string, unknown>;
type Emit = (event: RunEvent) => void;

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// Mirrors the console's stream handling so we can persist a faithful transcript of
// how the agent reasoned for each purchase (auditability of autonomous spend).
function makeTranscript() {
  const lines: TranscriptLine[] = [];
  let buf = "";
  let bufFinal = false;
  let sbuf = "";
  const flush = () => {
    if (buf.trim()) lines.push({ kind: bufFinal ? "result" : "thinking", text: buf.trim() });
    buf = "";
    bufFinal = false;
  };
  return {
    lines,
    flush,
    capture(e: RunEvent) {
      if (e.kind === "deal") {
        flush();
        lines.push({
          kind: "deal",
          text: [str(e.deal), str(e.price), str(e.network)].filter(Boolean).join(" · "),
        });
        return;
      }
      if (e.kind === "escrow") {
        flush();
        lines.push({ kind: "escrow", text: `escrow #${str(e.escrowId) ?? "—"}` });
        return;
      }
      if (e.kind === "coverage") {
        flush();
        const id = str(e.coverageId);
        const status = str(e.status);
        lines.push({
          kind: "coverage",
          text:
            status === "active"
              ? `Insurance #${id ?? "—"} active · payout on delivery breach`
              : `Insurance ${status ?? "pending"} · payout pending one-time setup (testnet)`,
          tx: str(e.tx) ?? null,
        });
        return;
      }
      if (e.zone === "seller" && e.streamEnd) {
        if (sbuf.trim()) lines.push({ kind: "delivery", text: `Seller: ${sbuf.trim()}` });
        sbuf = "";
        return;
      }
      if (e.zone === "seller" && e.stream) {
        sbuf += str(e.msg) ?? "";
        return;
      }
      if (e.zone === "seller" && str(e.msg)) {
        flush();
        if (sbuf.trim()) {
          lines.push({ kind: "delivery", text: `Seller: ${sbuf.trim()}` });
          sbuf = "";
        }
        lines.push({ kind: "delivery", text: `Seller: ${str(e.msg)!}`, tx: str(e.tx) ?? null });
        return;
      }
      if (e.zone === "buyer" && e.streamEnd) {
        flush();
        return;
      }
      if (e.zone === "buyer" && e.stream) {
        buf += str(e.msg) ?? "";
        bufFinal = !!e.final;
        return;
      }
      if (e.zone === "buyer" && str(e.msg)) {
        flush();
        lines.push({ kind: "action", text: str(e.msg)! });
        return;
      }
      if (e.zone === "provider" && str(e.msg)) {
        flush();
        lines.push({ kind: "delivery", text: str(e.msg)!, detail: str(e.detail) ?? null });
        return;
      }
      if (e.zone === "system" && str(e.msg)) {
        flush();
        lines.push({ kind: "system", text: str(e.msg)!, tx: str(e.tx) ?? null });
      }
    },
  };
}

// Cosmetic pacing between narration steps so the "theater" is readable.
// The settlement itself is real and on-chain; these delays only slow the storytelling.
const STEP_MS = 850;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MODEL = "claude-haiku-4-5-20251001";

// Hard cap on agent reasoning turns — the load-bearing safety bound on a run
// (one buy per run is enforced separately by the idempotency guard below).
const MAX_AGENT_TURNS = 4;

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
type SellerRunResult = { report: LiveReport; delivered: boolean; sellerRead: string | null };

// The REAL x402 deal: GET → 402 → sign EIP-3009 → re-GET with payment → on-chain
// settle via the facilitator → live report. Emits the same system/provider/deal/tx
// events the demo has always emitted, and returns the freshly-fetched artifact so
// the agent reasons over real data (never a faked tool result).
async function createBuyerSigner(
  emit: Emit,
  agent: AgentRecord | null,
  treasury: string | null,
): Promise<ClientEvmSigner> {
  // Model B: the agent pays from the passkey-owned treasury via its session key —
  // no per-agent wallet. The session key signs the EIP-3009 authorization.
  if (treasury) {
    const t = await getTreasurySigner(treasury);
    if (!t) {
      throw new Error(
        "Treasury has no spend authorization — open the treasury panel and authorize a budget first.",
      );
    }
    // A fresh treasury is counterfactual; activate it on-chain once so its EIP-3009
    // signature verifies over ERC-1271.
    try {
      const { deployedNow, txHash } = await ensureTreasuryDeployed(treasury);
      if (deployedNow) {
        emit({
          zone: "buyer",
          msg: "Activating treasury on-chain (deploy + session key) — gas sponsored",
          tx: txHash,
          arbiscan: txHash ? `https://sepolia.arbiscan.io/tx/${txHash}` : undefined,
        });
      }
    } catch (error) {
      throw new Error(
        `Could not activate the treasury on-chain (${errorMessage(error)}). If this is an older passkey ` +
          `treasury, open the treasury panel → Reset → Use existing to re-create it on the patched validator.`,
      );
    }
    const remaining =
      t.budgetAtomic != null ? BigInt(t.budgetAtomic) - BigInt(t.spentAtomic) : null;
    emit({
      zone: "buyer",
      msg:
        `${agent ? `Agent "${agent.name}"` : "Agent"} pays from the passkey treasury ` +
        `${shortAddr(t.signer.address)} via its session key` +
        (remaining != null ? ` · ${(Number(remaining) / 1e6).toFixed(2)} USDC left in budget` : ""),
    });
    return t.signer;
  }

  const agentKey = agent?.ownerPrivateKey ?? process.env.AGENT_PRIVATE_KEY;
  if (agentKey) {
    const wallet = await createAgentWallet(agentKey as `0x${string}`);
    emit({
      zone: "buyer",
      msg: `${agent ? `Passkey treasury for agent "${agent.name}"` : "Passkey treasury"} (ZeroDev Kernel): ${wallet.address}`,
    });
    const { deployedNow, txHash } = await wallet.deployIfNeeded();
    if (deployedNow) {
      emit({
        zone: "buyer",
        msg: "Treasury activated on-chain (gas sponsored by paymaster)",
        tx: txHash,
        arbiscan: txHash ? `https://sepolia.arbiscan.io/tx/${txHash}` : undefined,
      });
    }
    const balance = await wallet.usdcBalance();
    emit({
      zone: "buyer",
      msg: `Treasury balance: ${(Number(balance) / 1e6).toFixed(2)} USDC`,
    });
    if (balance === 0n) {
      emit({
        zone: "system",
        level: "error",
        msg: `Treasury ${wallet.address} holds 0 USDC — faucet testnet USDC to it before running.`,
      });
    }
    return wallet.signer;
  }

  const buyerKey = process.env.BUYER_PRIVATE_KEY;
  if (!buyerKey) {
    throw new Error("Neither a passkey treasury nor BUYER_PRIVATE_KEY is configured");
  }
  const account = privateKeyToAccount(buyerKey as `0x${string}`);
  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(process.env.ARBITRUM_SEPOLIA_RPC_URL),
  });
  return toClientEvmSigner(account, publicClient);
}

async function runX402Payment(
  resource: string,
  emit: Emit,
  agent: AgentRecord | null,
  resourceId: string,
  recorded: string[],
  treasury: string | null,
  apiKey: string | undefined,
  forceDecline: boolean,
): Promise<SellerRunResult> {
  const signer = await createBuyerSigner(emit, agent, treasury);

  const wantsCoverage = !!agent?.pluginIds.includes(COVERAGE_PLUGIN_ID);
  const params = new URLSearchParams({ resourceId });
  if (agent?.deadlineSeconds) params.set("deadlineSeconds", String(agent.deadlineSeconds));
  if (wantsCoverage) params.set("coverage", "1");
  const resourceUrl = `${resource}?${params.toString()}`;

  const unpaid = await fetch(resourceUrl, { headers: { accept: "application/json" } });
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

  if (treasury) {
    const session = await getSession(treasury);
    if (session?.budgetAtomic) {
      const remaining = BigInt(session.budgetAtomic) - BigInt(session.spentAtomic ?? "0");
      if (BigInt(requirements.amount) > remaining) {
        throw new Error(
          `over treasury spend budget: ${(Number(remaining) / 1e6).toFixed(2)} USDC left, ` +
            `this resource costs ${(Number(requirements.amount) / 1e6).toFixed(2)} — re-authorize a larger budget`,
        );
      }
    }
  }

  const price = formatUsdc(requirements.amount);
  const network = networkLabel(requirements.network);
  const escrowExtra = getEscrowExtra(requirements);
  emit({
    kind: "deal",
    deal: paymentRequired.resource?.description ?? "x402 resource",
    price,
    network,
  });
  if (escrowExtra) {
    emit({
      kind: "escrow",
      escrowId: escrowExtra.escrowId,
      escrowDeadline: requirements.extra?.escrowDeadline ?? null,
    });
  }
  await sleep(STEP_MS);
  emit({
    zone: "system",
    msg: escrowExtra
      ? `402 Payment Required — provider asks ${price}, payment goes to Escrow #${escrowExtra.escrowId} (not directly to the seller)`
      : `402 Payment Required — provider asks ${price} for the call`,
  });
  await sleep(STEP_MS);

  const scheme = new ExactEvmScheme(signer);
  const partial = await scheme.createPaymentPayload(paymentRequired.x402Version, requirements);
  const payment: PaymentPayload = {
    x402Version: partial.x402Version,
    resource: paymentRequired.resource,
    accepted: requirements,
    payload: partial.payload as unknown as Record<string, unknown>,
    extensions: paymentRequired.extensions,
  };
  emit({
    zone: "buyer",
    msg: escrowExtra
      ? "Signs the payment from the passkey treasury session key — EIP-3009 ReceiveWithAuthorization, nonce bound to the Escrow"
      : "Signs the payment — EIP-3009, no gas, no wallet popup",
  });
  await sleep(STEP_MS);

  emit({
    zone: "system",
    msg: escrowExtra
      ? "Facilitator verifies the treasury signature (ERC-1271), then settles into Escrow on Arbitrum…"
      : "Facilitator verifies the signature, then settles on Arbitrum (pays gas for the buyer)…",
  });
  const paid = await fetch(resourceUrl, {
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

  if (agent) {
    const def = getResource(resourceId);
    const escrowDeadline = requirements.extra?.escrowDeadline;
    const ts = new Date().toISOString();
    recorded.push(ts);
    await recordSpend(agent.id, {
      ts,
      escrowId: escrowExtra?.escrowId ?? null,
      amountAtomic: requirements.amount,
      tx: tx ?? null,
      resource,
      description: paymentRequired.resource?.description ?? "x402 resource",
      resourceId,
      resourceName: def.name,
      result: null,
      artifact: null,
      deadline: typeof escrowDeadline === "number" ? escrowDeadline : null,
      released: false,
      releaseTx: null,
    });
  }

  if (treasury) {
    await addSpent(treasury, BigInt(requirements.amount));
  }

  await sleep(STEP_MS);
  emit({
    zone: "system",
    msg: escrowExtra
      ? `Paid ✓ — USDC moved from treasury → Escrow #${escrowExtra.escrowId} (seller is paid when the Gate condition is met)`
      : "Paid ✓ — USDC moved Buyer → Provider",
    tx,
    arbiscan: tx ? `https://sepolia.arbiscan.io/tx/${tx}` : undefined,
  });
  await sleep(STEP_MS);

  if (wantsCoverage && escrowExtra && agent) {
    const holder = (treasury ?? agent.address) as `0x${string}`;
    const escrowDeadline = requirements.extra?.escrowDeadline;
    // Coverage must outlive the delivery deadline: a breach only becomes claimable AFTER
    // the deadline passes, so the buyer needs a window past it to file the claim.
    const CLAIM_WINDOW_SECONDS = 3600;
    const baseExpiry =
      typeof escrowDeadline === "number" ? escrowDeadline : Math.floor(Date.now() / 1000) + 300;
    const expiry = baseExpiry + CLAIM_WINDOW_SECONDS;
    emit({
      zone: "buyer",
      msg: "Attaches Insurance coverage to the Escrow — DeliveryPolicy on the underwriter pool",
    });
    try {
      const cov = await attachCoverage({
        escrowId: escrowExtra.escrowId,
        amountAtomic: requirements.amount,
        expiry,
        holder,
      });
      await markSpendCovered(escrowExtra.escrowId, {
        coverageId: cov.coverageId,
        tx: cov.tx,
        pool: cov.pool,
        policy: cov.policy,
        holder: cov.holder,
        expiry: cov.expiry,
        amountAtomic: cov.amountAtomic,
        status: cov.status,
        note: cov.note,
      });
      if (cov.status === "active") {
        emit({ kind: "coverage", coverageId: cov.coverageId, tx: cov.tx, status: cov.status });
        emit({
          zone: "system",
          msg: `Insurance active ✓ — coverage #${cov.coverageId} bound to Escrow #${escrowExtra.escrowId} (buyer can claim if the seller breaches delivery)`,
          tx: cov.tx ?? undefined,
          arbiscan: cov.tx ? `https://sepolia.arbiscan.io/tx/${cov.tx}` : undefined,
        });
      } else if (cov.status === "pending-setup") {
        emit({ kind: "coverage", status: cov.status });
        emit({
          zone: "system",
          msg: `Insurance pending one-time protocol setup — ${cov.note ?? "owner setup not yet applied"}. The purchase itself is unaffected.`,
        });
      } else {
        emit({ zone: "system", level: "error", msg: cov.note ?? "Insurance attach failed" });
      }
    } catch (covErr) {
      emit({ zone: "system", level: "error", msg: `Insurance attach error: ${errorMessage(covErr)}` });
    }
    await sleep(STEP_MS);
  }

  // The seller is its own agent: it reasons over the freshly-fetched data and either delivers
  // a composed read (attesting delivery on-chain → escrow releases) or declines, in which case
  // the escrow breaches at its deadline and the buyer can claim.
  emit({ zone: "seller", msg: "Order routed to the seller agent — Reineira Data Desk" });
  await sleep(STEP_MS);
  const outcome = await runSellerAgent({
    resource: getResource(resourceId),
    artifact: paidBody.artifact ?? {},
    emit,
    apiKey,
    forceDecline,
  });

  const report: LiveReport = { ...(paidBody.artifact ?? {}) };
  if (!outcome.delivered) {
    emit({
      zone: "system",
      msg: escrowExtra
        ? `Seller declined — ${price} stays held in Escrow #${escrowExtra.escrowId}; if delivery is not attested before the deadline, the buyer can claim Insurance.`
        : "Seller declined the order — no data delivered.",
    });
    return { report, delivered: false, sellerRead: null };
  }

  const sellerRead = outcome.report ?? paidBody.artifact?.result ?? null;
  if (sellerRead) report.result = sellerRead;

  const sellerConfig = getSellerEscrowConfig();
  let releaseTx: string | undefined;
  if (escrowExtra && sellerConfig?.deliveryResolver) {
    try {
      const res = await attestAndRedeem(sellerConfig, BigInt(escrowExtra.escrowId));
      releaseTx = res.redeemTx;
      emit({
        zone: "seller",
        msg: "Attests delivery on-chain and redeems the Escrow — payment released to the seller",
        tx: res.redeemTx,
        arbiscan: `https://sepolia.arbiscan.io/tx/${res.redeemTx}`,
      });
    } catch (relErr) {
      emit({
        zone: "seller",
        msg: `Could not release the Escrow on-chain (${errorMessage(relErr)}) — it can be released manually from Purchases.`,
      });
    }
  }

  emit({
    zone: "provider",
    msg: "Seller delivers the data report",
    detail: sellerRead ?? undefined,
    artifact: paidBody.artifact,
  });

  if (agent && escrowExtra && sellerRead) {
    await markSpendDelivered(escrowExtra.escrowId, {
      result: sellerRead,
      artifact: paidBody.artifact ?? null,
      releaseTx,
    });
  }

  return { report, delivered: true, sellerRead };
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

function buildSystemPrompt(
  agent: AgentRecord | null,
  resource: ResourceDef,
  remainingBudgetUsdc: string | null,
): string {
  const price = (Number(resource.priceAtomic) / 1e6).toFixed(2);
  const budgetLine =
    remainingBudgetUsdc != null
      ? `Your treasury has ${remainingBudgetUsdc} USDC of authorized spend budget left.`
      : `You operate within a small autonomous spend budget.`;
  const base =
    `You are an autonomous buying agent settling payments over x402.\n` +
    `Task: ${resource.task}\n` +
    `${budgetLine}\n` +
    `A live data report "${resource.name}" is available for about ${price} USDC, paid into Escrow with Gate-verified release conditions ` +
    `(funds are held, not sent straight to the seller). You do not currently have this data.\n\n` +
    `Decide — guided by your standing instructions and your remaining budget — whether buying it is worth it right now. ` +
    `Think out loud briefly (1–2 sentences, in your own voice). Then EITHER call fetch_live_report to buy it, ` +
    `OR, if you judge it is not worth it (too costly for your budget, or against your instructions), say why in one line and do NOT call the tool. ` +
    `If you buy, once the data arrives give a single crisp read in your own voice that cites the concrete numbers. Keep output terse; this is a live demo.`;
  if (agent?.prePrompt) {
    return `Your standing instructions — act in this persona, let it drive your decision and tone:\n${agent.prePrompt}\n\n${base}`;
  }
  return base;
}

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const signal = request.signal;
  const resource = resourceUrl(request);
  const url = new URL(request.url);
  const resourceDef = getResource(url.searchParams.get("resourceId"));
  const treasury = url.searchParams.get("treasury");
  const forceDecline = url.searchParams.get("sellerDecline") === "1";
  const mode = url.searchParams.get("mode");
  const falseAlarm = url.searchParams.get("falseAlarm") === "1";

  let agent: AgentRecord | null = null;
  try {
    const agentId = url.searchParams.get("agentId");
    if (agentId) {
      agent = await getAgent(agentId);
      if (!agent) {
        return new Response(JSON.stringify({ error: "agent not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
    }
  } catch {
    agent = null;
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let aborted = signal.aborted;
      const onAbort = () => {
        aborted = true;
      };
      signal.addEventListener("abort", onAbort);
      const transcript = makeTranscript();
      const emit: Emit = (event) => {
        if (aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Client disconnected: stop trying to write so the run can wind down quietly.
          aborted = true;
          return;
        }
        transcript.capture(event);
      };
      const recorded: string[] = [];
      // Persist the captured reasoning to each spend so the Audit log survives even an
      // error/abort path (without it a real run can land in the ledger with an empty log).
      const persistTranscript = async () => {
        transcript.flush();
        if (agent && recorded.length) {
          for (const ts of recorded) {
            try {
              await updateSpendTranscript(agent.id, ts, transcript.lines);
            } catch {
              /* best-effort */
            }
          }
        }
      };
      const finishRun = async () => {
        await persistTranscript();
        emit({ done: true });
      };

      try {
        // Two-Key Halt / Bonded x402 showcase: a fully isolated branch that never touches the
        // data-buy hero path. Runs the bond → staged attack → Guardian pause → verdict → settle
        // choreography, every step a real Arbitrum Sepolia tx.
        if (mode === "twokey") {
          await runTwoKeyHalt({ emit, forceFalseAlarm: falseAlarm });
          emit({ done: true });
          return;
        }
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          // No LLM key: run a scripted buy so the full on-chain x402 → escrow flow is
          // still testable end-to-end in the browser (the reasoning narration is canned).
          emit({
            zone: "buyer",
            msg: `${agent ? `Agent "${agent.name}"` : "Agent"}: no LLM key set — running a scripted buy to demonstrate live x402 → Escrow settlement.`,
            stream: false,
          });
          await sleep(STEP_MS);
          emit({ zone: "buyer", msg: "Decides to buy the live report — initiating x402 payment" });
          await sleep(STEP_MS);
          const out = await runX402Payment(
            resource,
            emit,
            agent,
            resourceDef.id,
            recorded,
            treasury,
            apiKey,
            forceDecline,
          );
          await sleep(STEP_MS);
          emit({
            zone: "buyer",
            msg: out.delivered
              ? out.report.result
                ? `Market read: ${out.report.result}`
                : "Live report acquired."
              : "Seller declined — no data delivered; payment held in Escrow.",
            stream: true,
            final: true,
          });
          emit({ zone: "buyer", streamEnd: true, final: true });
          await finishRun();
          return;
        }

        let remainingBudgetUsdc: string | null = null;
        if (treasury) {
          const session = await getSession(treasury);
          if (session?.budgetAtomic) {
            const rem = BigInt(session.budgetAtomic) - BigInt(session.spentAtomic ?? "0");
            remainingBudgetUsdc = (Number(rem > 0n ? rem : 0n) / 1e6).toFixed(2);
          }
        }

        const anthropic = new Anthropic({ apiKey });
        const messages: MessageParam[] = [
          {
            role: "user",
            content:
              "Begin. Decide — in your persona, mindful of your budget — whether to buy the report, then act.",
          },
        ];

        let paid = false;
        let boughtReport: LiveReport | null = null;
        let boughtDelivered = false;

        // Agent loop: stream reasoning to the Buyer zone, run the real x402 payment
        // when the model calls the tool, feed the real artifact back, then stream the
        // model's final grounded answer. Capped to keep the demo bounded.
        for (let turn = 0; turn < MAX_AGENT_TURNS; turn += 1) {
          // Client gone: stop reasoning so an abandoned run doesn't keep spending.
          if (aborted || signal.aborted) break;
          const isFinalTurn = paid;

          const modelStream = anthropic.messages.stream(
            {
              model: MODEL,
              max_tokens: 600,
              system: buildSystemPrompt(agent, resourceDef, remainingBudgetUsdc),
              tools: [FETCH_LIVE_REPORT_TOOL],
              messages,
            },
            { signal },
          );

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
            // No tool call: the model produced its (final) answer. If it never bought,
            // it deliberately declined (persona/budget) — surface that as the outcome.
            if (!paid) {
              emit({ zone: "system", msg: "Agent decided not to buy — no payment made." });
            }
            await finishRun();
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

            // Idempotency: one real on-chain payment per run. If the model re-calls the
            // tool, hand back the data it already bought instead of charging again.
            if (paid) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify(
                  boughtDelivered
                    ? { status: "already_purchased", report: boughtReport }
                    : {
                        status: "not_delivered",
                        note: "You already initiated this purchase; the seller declined and your payment is held in escrow. Do not buy again — answer from what you have or explain you have no data.",
                      },
                ),
              });
              continue;
            }

            emit({
              zone: "buyer",
              msg: "Decides to buy the live report — initiating x402 payment",
            });
            await sleep(STEP_MS);

            const out = await runX402Payment(
              resource,
              emit,
              agent,
              resourceDef.id,
              recorded,
              treasury,
              apiKey,
              forceDecline,
            );
            paid = true;
            boughtReport = out.report;
            boughtDelivered = out.delivered;

            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: out.delivered
                ? JSON.stringify({ status: "delivered", report: out.report })
                : JSON.stringify({
                    status: "not_delivered",
                    note: "The seller declined to deliver. Your payment is held in Escrow; if delivery is not attested before the deadline, you can file an Insurance claim. You do not have the data.",
                  }),
            });
          }

          messages.push({ role: "user", content: toolResults });
        }

        // Safety net: loop exhausted without a final text-only turn.
        await finishRun();
      } catch (error) {
        // A client abort surfaces here too; don't report it as a run failure.
        if (!(aborted || signal.aborted)) {
          await persistTranscript();
          emit({ zone: "system", level: "error", msg: errorMessage(error) });
          emit({ done: true });
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          /* already closed/errored */
        }
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

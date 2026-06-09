import { NextResponse } from "next/server";
import { createPublicClient, http, formatGwei } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { ARBITRUM_SEPOLIA, X402 } from "@reineira-os/x402-rss-shared";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@reineira-os/x402-core/http";
import type { SettleResponse, VerifyResponse } from "@reineira-os/x402-core/types";

export const dynamic = "force-dynamic";

const PRICE_USDC_ATOMIC = "100000";
const PAY_TO = "0x000000000000000000000000000000000000dEaD";

function buildPaymentRequired() {
  return {
    x402Version: X402.version,
    error: "payment required",
    resource: {
      url: "/api/resource",
      description: "Live on-chain data report — Arbitrum Sepolia block + ETH price",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: X402.scheme,
        network: X402.network,
        amount: PRICE_USDC_ATOMIC,
        asset: ARBITRUM_SEPOLIA.usdc,
        payTo: PAY_TO,
        maxTimeoutSeconds: 120,
        extra: { name: X402.eip712.name, version: X402.eip712.version },
      },
    ],
  };
}

function facilitatorUrl(path: string): string {
  const base = process.env.FACILITATOR_URL ?? "http://localhost:4021";
  return `${base.replace(/\/$/, "")}${path}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The actual paid resource: fetched LIVE at request time (nothing hardcoded).
async function fetchLiveReport() {
  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(process.env.ARBITRUM_SEPOLIA_RPC_URL),
  });

  const [block, gasPrice] = await Promise.all([
    publicClient.getBlock(),
    publicClient.getGasPrice(),
  ]);

  let ethUsd: string | undefined;
  try {
    const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
      headers: { accept: "application/json" },
    });
    const json = (await res.json()) as { data?: { amount?: string } };
    ethUsd = json?.data?.amount;
  } catch {
    ethUsd = undefined;
  }

  const blockNumber = Number(block.number);
  const gasGwei = formatGwei(gasPrice);
  const blockTime = new Date(Number(block.timestamp) * 1000).toISOString();
  const result =
    `Arbitrum Sepolia block ${blockNumber.toLocaleString("en-US")} · gas ${gasGwei} gwei` +
    (ethUsd ? ` · ETH $${Number(ethUsd).toLocaleString("en-US")}` : "");

  return {
    service: "Live on-chain data report",
    chain: "Arbitrum Sepolia",
    blockNumber,
    blockTime,
    gasGwei,
    ethUsd: ethUsd ? `$${ethUsd}` : null,
    result,
    asOf: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  const paymentHeader = request.headers.get("payment-signature");

  if (!paymentHeader) {
    const paymentRequired = buildPaymentRequired();
    return NextResponse.json(paymentRequired, {
      status: 402,
      headers: {
        "payment-required": encodePaymentRequiredHeader(
          paymentRequired as Parameters<typeof encodePaymentRequiredHeader>[0],
        ),
      },
    });
  }

  let payment: ReturnType<typeof decodePaymentSignatureHeader>;
  try {
    payment = decodePaymentSignatureHeader(paymentHeader);
  } catch {
    return NextResponse.json({ error: "malformed payment-signature header" }, { status: 400 });
  }
  if (!payment.accepted) {
    return NextResponse.json({ error: "invalid payment payload" }, { status: 400 });
  }

  const body = {
    paymentPayload: payment,
    paymentRequirements: payment.accepted,
  };

  let verify: VerifyResponse;
  try {
    const verifyRes = await fetch(facilitatorUrl("/verify"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    verify = (await verifyRes.json()) as VerifyResponse;
  } catch (error) {
    return NextResponse.json(
      { error: "facilitator verify unreachable", detail: errorMessage(error) },
      { status: 502 },
    );
  }

  if (verify.isValid !== true) {
    const paymentRequired = buildPaymentRequired();
    return NextResponse.json(
      { ...paymentRequired, error: verify.invalidReason ?? "payment not valid" },
      {
        status: 402,
        headers: {
          "payment-required": encodePaymentRequiredHeader(
            paymentRequired as Parameters<typeof encodePaymentRequiredHeader>[0],
          ),
        },
      },
    );
  }

  let settle: SettleResponse;
  try {
    const settleRes = await fetch(facilitatorUrl("/settle"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    settle = (await settleRes.json()) as SettleResponse;
  } catch (error) {
    return NextResponse.json(
      { error: "facilitator settle unreachable", detail: errorMessage(error) },
      { status: 502 },
    );
  }

  if (!settle.success) {
    return NextResponse.json(
      { error: settle.errorReason ?? "settlement failed", detail: settle.errorMessage },
      { status: 502 },
    );
  }

  // Payment settled — now serve the REAL, freshly-fetched resource.
  const artifact = await fetchLiveReport();

  return NextResponse.json(
    {
      artifact,
      settlement: {
        verified: true,
        transaction: settle.transaction,
        payer: settle.payer,
        network: settle.network,
      },
    },
    {
      status: 200,
      headers: {
        "payment-response": encodePaymentResponseHeader(settle),
      },
    },
  );
}

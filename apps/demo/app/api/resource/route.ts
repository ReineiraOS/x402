import { NextResponse } from "next/server";
import { ARBITRUM_SEPOLIA, X402 } from "@reineira-os/x402-rss-shared";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from "@x402/core/http";

export const dynamic = "force-dynamic";

const PRICE_USDC_ATOMIC = "100000";
const PAY_TO = "0x000000000000000000000000000000000000dEaD";

function buildPaymentRequired() {
  return {
    x402Version: X402.version,
    error: "payment required",
    resource: {
      url: "/api/resource",
      description: "Mock batch-inference job (1 batch, 12 shards)",
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

  // STUB: real settlement verification (facilitator + RSS escrow) lands in B (DEV-194)
  const payment = decodePaymentSignatureHeader(paymentHeader);
  const authorization = (payment.payload as { authorization?: { from?: string } }).authorization;

  return NextResponse.json(
    {
      artifact: {
        job: "batch-inference",
        status: "completed",
        shards: 12,
        result: "mock-artifact://settlement-theater/0xstub",
      },
      settlement: {
        verified: false,
        note: "skeleton — payment-signature decoded but not verified",
        payer: authorization?.from ?? null,
        network: payment.accepted.network,
        amount: payment.accepted.amount,
      },
    },
    { status: 200 },
  );
}

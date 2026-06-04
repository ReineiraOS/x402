import { NextResponse } from "next/server";
import { ARBITRUM_SEPOLIA, X402 } from "@reineira-os/x402-rss-shared";

export const dynamic = "force-dynamic";

const PRICE_USDC_ATOMIC = "100000";

function buildPaymentRequired() {
  return {
    x402Version: X402.version,
    accepts: [
      {
        scheme: X402.scheme,
        network: X402.network,
        asset: ARBITRUM_SEPOLIA.usdc,
        maxAmountRequired: PRICE_USDC_ATOMIC,
        resource: "/api/resource",
        description: "Mock batch-inference job (1 batch, 12 shards)",
        mimeType: "application/json",
        payTo: "0x0000000000000000000000000000000000000000",
        maxTimeoutSeconds: 120,
        extra: {
          name: "USD Coin",
          decimals: 6,
        },
      },
    ],
    error: "payment required",
  };
}

export async function GET(request: Request) {
  const payment = request.headers.get("x-payment");

  if (!payment) {
    return NextResponse.json(buildPaymentRequired(), {
      status: 402,
      headers: { "x-payment-required": "true" },
    });
  }

  // STUB: real settlement verification (facilitator + RSS escrow) lands in B (DEV-194)
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
        note: "skeleton — payment header echoed but not verified",
      },
    },
    { status: 200 },
  );
}

import { NextResponse } from "next/server";
import { createPublicClient, http, formatGwei } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { ARBITRUM_SEPOLIA, X402 } from "@reineira-os/x402-rss-shared";
import type { X402EscrowExtra } from "@reineira-os/x402-rss-shared";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@reineira-os/x402-core/http";
import type { SettleResponse, VerifyResponse } from "@reineira-os/x402-core/types";
import {
  createEscrowForSale,
  getSellerEscrowConfig,
  validateIssuedEscrow,
} from "../../../lib/sellerEscrow";
import { getResource } from "../../../lib/resources";

export const dynamic = "force-dynamic";

const PAY_TO = "0x000000000000000000000000000000000000dEaD";

async function buildPaymentRequired(deadlineSeconds?: number, resourceId?: string, coverage = false) {
  const escrowConfig = getSellerEscrowConfig();
  const resource = getResource(resourceId);

  let payTo: string = PAY_TO;
  let extra: Record<string, unknown> = {
    name: X402.eip712.name,
    version: X402.eip712.version,
  };

  if (escrowConfig) {
    // Every escrow uses the delivery resolver so the seller agent has a real on-chain
    // action (attest delivery → release); coverage is an independent add-on on top.
    const useDelivery = !!escrowConfig.deliveryResolver;
    const issued = await createEscrowForSale(
      escrowConfig,
      BigInt(resource.priceAtomic),
      deadlineSeconds,
      useDelivery,
    );
    payTo = issued.extra.receiver;
    extra = {
      ...extra,
      escrow: issued.extra,
      escrowDeadline: issued.deadline,
      resourceId: resource.id,
      coverage,
    };
  }

  return {
    x402Version: X402.version,
    error: "payment required",
    resource: {
      url: "/api/resource",
      description: resource.description,
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: X402.scheme,
        network: X402.network,
        amount: resource.priceAtomic,
        asset: ARBITRUM_SEPOLIA.usdc,
        payTo,
        maxTimeoutSeconds: 120,
        extra,
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
  const url = new URL(request.url);
  const deadlineSeconds = Number(url.searchParams.get("deadlineSeconds")) || undefined;
  const resourceId = url.searchParams.get("resourceId") ?? undefined;
  const coverage = url.searchParams.get("coverage") === "1";
  const resource = getResource(resourceId);

  if (!paymentHeader) {
    let paymentRequired: Awaited<ReturnType<typeof buildPaymentRequired>>;
    try {
      paymentRequired = await buildPaymentRequired(deadlineSeconds, resourceId, coverage);
    } catch (error) {
      return NextResponse.json(
        { error: "failed to open escrow for sale", detail: errorMessage(error) },
        { status: 500 },
      );
    }
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

  const escrowConfig = getSellerEscrowConfig();
  if (escrowConfig) {
    const acceptedExtra = payment.accepted.extra?.escrow as
      | X402EscrowExtra
      | undefined;
    if (!acceptedExtra) {
      return NextResponse.json(
        { error: "escrow payment required: missing escrow extra" },
        { status: 400 },
      );
    }
    const validation = await validateIssuedEscrow(
      escrowConfig,
      acceptedExtra,
      BigInt(resource.priceAtomic),
      !!escrowConfig.deliveryResolver,
    );
    if (!validation.ok) {
      return NextResponse.json(
        { error: `escrow validation failed: ${validation.reason}` },
        { status: 400 },
      );
    }
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
    const paymentRequired = await buildPaymentRequired(deadlineSeconds, resourceId, coverage);
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

import { ARBITRUM_SEPOLIA, X402 } from "@reineira-os/x402-rss-shared";
import { Hono } from "hono";
import type { x402Facilitator } from "@x402/core/facilitator";

type FacilitatorLike = Pick<x402Facilitator, "verify" | "settle">;

export function createApp(facilitator: FacilitatorLike): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/supported", (c) =>
    c.json({
      x402Version: X402.version,
      kinds: [{ scheme: X402.scheme, network: X402.network, asset: ARBITRUM_SEPOLIA.usdc }],
    }),
  );

  app.post("/verify", async (c) => {
    let body: { paymentPayload?: unknown; paymentRequirements?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ isValid: false, invalidReason: "malformed request body" }, 400);
    }
    if (!body.paymentPayload || !body.paymentRequirements) {
      return c.json({ isValid: false, invalidReason: "missing paymentPayload or paymentRequirements" }, 400);
    }
    const result = await facilitator.verify(body.paymentPayload as never, body.paymentRequirements as never);
    return c.json(result);
  });

  app.post("/settle", async (c) => {
    let body: { paymentPayload?: unknown; paymentRequirements?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, errorReason: "malformed request body" }, 400);
    }
    if (!body.paymentPayload || !body.paymentRequirements) {
      return c.json({ success: false, errorReason: "missing paymentPayload or paymentRequirements" }, 400);
    }
    const result = await facilitator.settle(body.paymentPayload as never, body.paymentRequirements as never);
    return c.json(result);
  });

  return app;
}

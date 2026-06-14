import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { X402Facilitator } from "@reineira-os/x402-core/facilitator";

type FacilitatorLike = Pick<X402Facilitator, "verify" | "settle" | "getSupported">;

// A valid x402 exact payload is well under 64KB; cap the body so a public endpoint can't
// be forced to buffer/parse an oversized request before any validation runs.
const limitBody = bodyLimit({ maxSize: 64 * 1024 });

export function createApp(facilitator: FacilitatorLike): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Canonical x402 discovery shape (kinds + signers), straight from the registry —
  // no second hand-rolled source of truth to drift.
  app.get("/supported", (c) => c.json(facilitator.getSupported()));

  app.post("/verify", limitBody, async (c) => {
    let body: { paymentPayload?: unknown; paymentRequirements?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ isValid: false, invalidReason: "malformed request body" }, 400);
    }
    if (!body.paymentPayload || !body.paymentRequirements) {
      return c.json(
        { isValid: false, invalidReason: "missing paymentPayload or paymentRequirements" },
        400,
      );
    }
    try {
      const result = await facilitator.verify(
        body.paymentPayload as never,
        body.paymentRequirements as never,
      );
      return c.json(result);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "verify failed";
      return c.json({ isValid: false, invalidReason: reason }, 502 as const);
    }
  });

  app.post("/settle", limitBody, async (c) => {
    let body: { paymentPayload?: unknown; paymentRequirements?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, errorReason: "malformed request body" }, 400);
    }
    if (!body.paymentPayload || !body.paymentRequirements) {
      return c.json(
        { success: false, errorReason: "missing paymentPayload or paymentRequirements" },
        400,
      );
    }
    try {
      const result = await facilitator.settle(
        body.paymentPayload as never,
        body.paymentRequirements as never,
      );
      return c.json(result);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "settle failed";
      return c.json({ success: false, errorReason: reason }, 502 as const);
    }
  });

  return app;
}

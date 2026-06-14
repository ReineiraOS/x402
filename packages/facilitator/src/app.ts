import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { X402Facilitator } from "@reineira-os/x402-core/facilitator";
import { isPaymentPayload, isPaymentRequirements } from "./validation.js";
import { rateLimit } from "./rate-limit.js";

type FacilitatorLike = Pick<X402Facilitator, "verify" | "settle" | "getSupported">;

// A valid x402 exact payload is well under 64KB; cap the body so a public endpoint can't
// be forced to buffer/parse an oversized request before any validation runs.
const limitBody = bodyLimit({ maxSize: 64 * 1024 });

const ErrInvalidRequest = "invalid_request";
const ErrVerifyFailed = "facilitator_verify_failed";
const ErrSettleFailed = "facilitator_settle_failed";

function corsOrigins(): string[] {
  const raw = process.env.FACILITATOR_CORS_ORIGINS;
  if (!raw) {
    return ["http://localhost:3000"];
  }
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function createApp(facilitator: FacilitatorLike): Hono {
  const app = new Hono();

  const allowedOrigins = corsOrigins();
  app.use(
    "*",
    cors({
      origin: allowedOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type"],
    }),
  );

  const guard = rateLimit({ windowMs: 60_000, max: 60 });

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Canonical x402 discovery shape (kinds + signers), straight from the registry —
  // no second hand-rolled source of truth to drift.
  app.get("/supported", (c) => c.json(facilitator.getSupported()));

  app.post("/verify", guard, limitBody, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ isValid: false, invalidReason: ErrInvalidRequest }, 400);
    }
    const { paymentPayload, paymentRequirements } = (body ?? {}) as {
      paymentPayload?: unknown;
      paymentRequirements?: unknown;
    };
    if (!isPaymentPayload(paymentPayload) || !isPaymentRequirements(paymentRequirements)) {
      return c.json({ isValid: false, invalidReason: ErrInvalidRequest }, 400);
    }
    try {
      const result = await facilitator.verify(paymentPayload, paymentRequirements);
      return c.json(result);
    } catch (err) {
      console.error("verify failed", err);
      return c.json({ isValid: false, invalidReason: ErrVerifyFailed }, 502 as const);
    }
  });

  app.post("/settle", guard, limitBody, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, errorReason: ErrInvalidRequest }, 400);
    }
    const { paymentPayload, paymentRequirements } = (body ?? {}) as {
      paymentPayload?: unknown;
      paymentRequirements?: unknown;
    };
    if (!isPaymentPayload(paymentPayload) || !isPaymentRequirements(paymentRequirements)) {
      return c.json({ success: false, errorReason: ErrInvalidRequest }, 400);
    }
    try {
      const result = await facilitator.settle(paymentPayload, paymentRequirements);
      return c.json(result);
    } catch (err) {
      console.error("settle failed", err);
      return c.json({ success: false, errorReason: ErrSettleFailed }, 502 as const);
    }
  });

  return app;
}

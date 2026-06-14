import type { PaymentPayload, PaymentRequirements } from "@reineira-os/x402-core/types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

export function isPaymentRequirements(value: unknown): value is PaymentRequirements {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.scheme === "string" &&
    typeof value.network === "string" &&
    typeof value.amount === "string" &&
    isOptionalString(value.asset) &&
    isOptionalString(value.payTo) &&
    (value.maxTimeoutSeconds === undefined ||
      typeof value.maxTimeoutSeconds === "number") &&
    (value.extra === undefined || value.extra === null || isObject(value.extra))
  );
}

export function isPaymentPayload(value: unknown): value is PaymentPayload {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.x402Version === "number" &&
    isObject(value.accepted) &&
    isObject(value.payload)
  );
}

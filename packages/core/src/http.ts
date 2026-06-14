import type { PaymentPayload, PaymentRequired, SettleResponse } from "./types.js";

const Base64EncodedRegex = /^[A-Za-z0-9+/]*={0,2}$/;

function safeBase64Encode(data: string): string {
  if (typeof globalThis !== "undefined" && typeof globalThis.btoa === "function") {
    const bytes = new TextEncoder().encode(data);
    const binaryString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    return globalThis.btoa(binaryString);
  }
  return Buffer.from(data, "utf8").toString("base64");
}

function safeBase64Decode(data: string): string {
  if (typeof globalThis !== "undefined" && typeof globalThis.atob === "function") {
    const binaryString = globalThis.atob(data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(bytes);
  }
  return Buffer.from(data, "base64").toString("utf-8");
}

// Decode a base64(JSON) header. A non-base64 string OR a base64-shaped-but-non-JSON
// payload (e.g. "", "YQ==") both surface as the same "Invalid payment ... header" error,
// rather than leaking a raw SyntaxError to facilitator/server callers.
function decodeHeader<T>(value: string, label: string): T {
  if (!Base64EncodedRegex.test(value)) {
    throw new Error(label);
  }
  try {
    return JSON.parse(safeBase64Decode(value)) as T;
  } catch {
    throw new Error(label);
  }
}

export function encodePaymentRequiredHeader(paymentRequired: PaymentRequired): string {
  return safeBase64Encode(JSON.stringify(paymentRequired));
}

export function decodePaymentRequiredHeader(paymentRequiredHeader: string): PaymentRequired {
  return decodeHeader<PaymentRequired>(paymentRequiredHeader, "Invalid payment required header");
}

export function encodePaymentSignatureHeader(paymentPayload: PaymentPayload): string {
  return safeBase64Encode(JSON.stringify(paymentPayload));
}

export function decodePaymentSignatureHeader(paymentSignatureHeader: string): PaymentPayload {
  return decodeHeader<PaymentPayload>(paymentSignatureHeader, "Invalid payment signature header");
}

export function encodePaymentResponseHeader(paymentResponse: SettleResponse): string {
  return safeBase64Encode(JSON.stringify(paymentResponse));
}

export function decodePaymentResponseHeader(paymentResponseHeader: string): SettleResponse {
  return decodeHeader<SettleResponse>(paymentResponseHeader, "Invalid payment response header");
}

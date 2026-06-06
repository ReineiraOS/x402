import { describe, it, expect } from "vitest";
import {
  encodePaymentRequiredHeader,
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
  decodePaymentSignatureHeader,
} from "../src/http.js";
import type { PaymentPayload, PaymentRequired } from "../src/types.js";

const PAY_TO = "0x000000000000000000000000000000000000dEaD";
const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";

function samplePaymentRequired(): PaymentRequired {
  return {
    x402Version: 2,
    error: "payment required",
    resource: {
      url: "/api/resource",
      description: "Mock batch-inference job (1 batch, 12 shards)",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:421614",
        amount: "100000",
        asset: USDC,
        payTo: PAY_TO,
        maxTimeoutSeconds: 120,
        extra: { name: "USD Coin", version: "2" },
      },
    ],
  };
}

function samplePaymentPayload(): PaymentPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:421614",
      amount: "100000",
      asset: USDC,
      payTo: PAY_TO,
      maxTimeoutSeconds: 120,
      extra: { name: "USD Coin", version: "2" },
    },
    payload: {
      authorization: {
        from: "0x1111111111111111111111111111111111111111",
        to: PAY_TO,
        value: "100000",
        validAfter: "1717689600",
        validBefore: "1717693200",
        nonce: "0x" + "ab".repeat(32),
      },
      signature: "0x" + "cd".repeat(65),
    },
  };
}

describe("http header codecs", () => {
  describe("encodePaymentRequiredHeader / decodePaymentRequiredHeader", () => {
    it("round-trips a PaymentRequired through base64(JSON)", () => {
      const original = samplePaymentRequired();
      const header = encodePaymentRequiredHeader(original);
      const decoded = decodePaymentRequiredHeader(header);
      expect(decoded).toEqual(original);
    });

    it("emits a base64-encoded JSON string", () => {
      const original = samplePaymentRequired();
      const header = encodePaymentRequiredHeader(original);
      expect(header).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
      expect(JSON.parse(Buffer.from(header, "base64").toString("utf-8"))).toEqual(original);
    });

    it("preserves load-bearing requirement fields", () => {
      const decoded = decodePaymentRequiredHeader(
        encodePaymentRequiredHeader(samplePaymentRequired()),
      );
      expect(decoded.x402Version).toBe(2);
      expect(decoded.error).toBe("payment required");
      expect(decoded.resource.url).toBe("/api/resource");
      const req = decoded.accepts[0];
      expect(req.scheme).toBe("exact");
      expect(req.network).toBe("eip155:421614");
      expect(req.amount).toBe("100000");
      expect(req.asset).toBe(USDC);
      expect(req.payTo).toBe(PAY_TO);
      expect(req.maxTimeoutSeconds).toBe(120);
      expect(req.extra).toEqual({ name: "USD Coin", version: "2" });
    });

    it("rejects a header that is not valid base64", () => {
      expect(() => decodePaymentRequiredHeader("not base64 !!!")).toThrow(
        "Invalid payment required header",
      );
    });
  });

  describe("encodePaymentSignatureHeader / decodePaymentSignatureHeader", () => {
    it("round-trips a PaymentPayload through base64(JSON)", () => {
      const original = samplePaymentPayload();
      const header = encodePaymentSignatureHeader(original);
      const decoded = decodePaymentSignatureHeader(header);
      expect(decoded).toEqual(original);
    });

    it("decodes to { accepted, payload, x402Version }", () => {
      const decoded = decodePaymentSignatureHeader(
        encodePaymentSignatureHeader(samplePaymentPayload()),
      );
      expect(decoded.x402Version).toBe(2);
      expect(decoded.accepted).toBeDefined();
      expect(decoded.payload).toBeDefined();
    });

    it("preserves load-bearing payload field names and shapes", () => {
      const decoded = decodePaymentSignatureHeader(
        encodePaymentSignatureHeader(samplePaymentPayload()),
      );
      expect(decoded.x402Version).toBe(2);
      expect(decoded.accepted.scheme).toBe("exact");
      expect(decoded.accepted.network).toBe("eip155:421614");
      expect(decoded.accepted.payTo).toBe(PAY_TO);
      expect(decoded.accepted.amount).toBe("100000");

      const auth = (decoded.payload as { authorization: Record<string, string> }).authorization;
      expect(auth.from).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(auth.to).toBe(PAY_TO);
      expect(auth.value).toBe("100000");
      expect(typeof auth.validAfter).toBe("string");
      expect(typeof auth.validBefore).toBe("string");
      expect(auth.nonce).toMatch(/^0x[0-9a-fA-F]{64}$/);

      const signature = (decoded.payload as { signature: string }).signature;
      expect(signature).toMatch(/^0x[0-9a-fA-F]+$/);
    });

    it("rejects a header that is not valid base64", () => {
      expect(() => decodePaymentSignatureHeader("not base64 !!!")).toThrow(
        "Invalid payment signature header",
      );
    });
  });
});

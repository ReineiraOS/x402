import { describe, it, expect, vi } from "vitest";
import { getAddress, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ExactEvmScheme,
  toClientEvmSigner,
  wrapFetchWithPayment,
  x402Client,
} from "../src/exact/client.js";
import { encodePaymentRequiredHeader, decodePaymentSignatureHeader } from "../src/http.js";
import type { PaymentRequired, PaymentRequirements } from "../src/types.js";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PAY_TO = getAddress("0x000000000000000000000000000000000000dEaD");
const USDC = getAddress("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
const NETWORK = "eip155:421614" as const;
const AMOUNT = "100000";

function requirement(): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    amount: AMOUNT,
    asset: USDC,
    payTo: PAY_TO,
    maxTimeoutSeconds: 120,
    extra: { name: "USD Coin", version: "2" },
  };
}

function paymentRequired(): PaymentRequired {
  return {
    x402Version: 2,
    error: "payment required",
    resource: { url: "/api/resource", description: "mock", mimeType: "application/json" },
    accepts: [requirement()],
  };
}

const fakePublicClient = {
  readContract: vi.fn(),
} as unknown as PublicClient;

function buildClient(): x402Client {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const signer = toClientEvmSigner(account, fakePublicClient);
  return new x402Client((_v, reqs) => {
    const chosen = reqs.find((r) => r.network === NETWORK && r.scheme === "exact");
    if (!chosen) throw new Error("no acceptable requirement");
    return chosen;
  }).register(NETWORK, new ExactEvmScheme(signer));
}

describe("ExactEvmScheme.createPaymentPayload", () => {
  it("builds a signed TransferWithAuthorization payload", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const signer = toClientEvmSigner(account, fakePublicClient);
    const scheme = new ExactEvmScheme(signer);

    const before = Math.floor(Date.now() / 1000);
    const result = await scheme.createPaymentPayload(2, requirement());
    const after = Math.floor(Date.now() / 1000);

    expect(result.x402Version).toBe(2);
    const auth = result.payload.authorization;
    expect(auth.from).toBe(account.address);
    expect(auth.to).toBe(PAY_TO);
    expect(auth.value).toBe(AMOUNT);
    expect(BigInt(auth.value)).toBe(BigInt(AMOUNT));
    expect(auth.nonce).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const validAfter = Number(auth.validAfter);
    const validBefore = Number(auth.validBefore);
    expect(validAfter).toBeGreaterThanOrEqual(before - 600 - 2);
    expect(validAfter).toBeLessThanOrEqual(after - 600 + 2);
    expect(validBefore).toBeGreaterThanOrEqual(before + 120 - 2);
    expect(validBefore).toBeLessThanOrEqual(after + 120 + 2);

    expect(result.payload.signature).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(result.payload.signature.length).toBe(132);
  });

  it("throws when extra.name/version are missing", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const scheme = new ExactEvmScheme(toClientEvmSigner(account, fakePublicClient));
    const req = { ...requirement(), extra: null };
    await expect(scheme.createPaymentPayload(2, req)).rejects.toThrow(/EIP-712 domain/);
  });
});

describe("x402Client", () => {
  it(".register returns this for chaining", () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const signer = toClientEvmSigner(account, fakePublicClient);
    const client = new x402Client();
    const returned = client.register(NETWORK, new ExactEvmScheme(signer));
    expect(returned).toBe(client);
  });

  it("createPaymentPayload assembles the full PaymentPayload with accepted requirements", async () => {
    const client = buildClient();
    const payload = await client.createPaymentPayload(paymentRequired());
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted.network).toBe(NETWORK);
    expect(payload.accepted.amount).toBe(AMOUNT);
    const auth = (payload.payload as { authorization: { to: string } }).authorization;
    expect(auth.to).toBe(PAY_TO);
  });
});

describe("wrapFetchWithPayment", () => {
  it("on 402 decodes requirements, signs, and retries with payment-signature header", async () => {
    const account = privateKeyToAccount(PRIVATE_KEY);
    const client = buildClient();

    const requiredHeader = encodePaymentRequiredHeader(paymentRequired());
    const baseFetch = vi.fn(async (input: Request) => {
      const req = input as Request;
      if (req.headers.has("payment-signature")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "payment required" }), {
        status: 402,
        headers: { "payment-required": requiredHeader },
      });
    });

    const wrapped = wrapFetchWithPayment(baseFetch as unknown as typeof fetch, client);
    const res = await wrapped("https://example.com/api/resource");

    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);

    const retryRequest = baseFetch.mock.calls[1]![0] as Request;
    const sigHeader = retryRequest.headers.get("payment-signature");
    expect(sigHeader).toBeTruthy();

    const decoded = decodePaymentSignatureHeader(sigHeader as string);
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepted.network).toBe(NETWORK);

    const auth = (decoded.payload as { authorization: { to: string; value: string }; signature: string })
      .authorization;
    expect(auth.to).toBe(PAY_TO);
    expect(BigInt((auth as { value: string }).value)).toBe(BigInt(AMOUNT));

    const signature = (decoded.payload as { signature: string }).signature;
    expect(signature).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  it("passes non-402 responses through with a single base fetch call", async () => {
    const client = buildClient();
    const baseFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const wrapped = wrapFetchWithPayment(baseFetch as unknown as typeof fetch, client);
    const res = await wrapped("https://example.com/api/resource");

    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });
});

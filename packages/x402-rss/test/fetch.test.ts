import { describe, it, expect, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { encodePaymentRequiredHeader, decodePaymentSignatureHeader } from "@x402/core/http";
import { createX402RssFetch } from "../src/fetch.js";
import { arbitrumSepolia } from "../src/config.js";

const ACCOUNT = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

const PAY_TO = "0x000000000000000000000000000000000000dEaD";

function paymentRequired(amount = "1000000", asset: string = arbitrumSepolia.usdc) {
  return {
    x402Version: 2,
    error: "payment required",
    resource: { url: "https://example.test/job" },
    accepts: [
      {
        scheme: "exact",
        network: arbitrumSepolia.network,
        amount,
        asset,
        payTo: PAY_TO,
        maxTimeoutSeconds: 120,
        extra: { name: "USD Coin", version: "2" },
      },
    ],
  };
}

function mockResource(amount = "1000000", asset: string = arbitrumSepolia.usdc) {
  const challenge = encodePaymentRequiredHeader(paymentRequired(amount, asset) as never);
  const calls: Array<{ headers: Headers }> = [];
  const fetch = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    calls.push({ headers: req.headers });
    if (!req.headers.get("payment-signature")) {
      return new Response(JSON.stringify(paymentRequired(amount, asset)), {
        status: 402,
        headers: { "content-type": "application/json", "payment-required": challenge },
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  return { fetch, calls };
}

describe("createX402RssFetch", () => {
  it("on 402, retries with a PAYMENT-SIGNATURE header carrying a signed exact authorization", async () => {
    const { fetch, calls } = mockResource();
    const f = createX402RssFetch({ account: ACCOUNT, fetch: fetch as never });
    const res = await f("https://example.test/job");

    expect(res.status).toBe(200);

    const paid = calls.at(-1)?.headers.get("payment-signature");
    expect(paid).toBeTruthy();

    const decoded = decodePaymentSignatureHeader(paid!);
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepted.network).toBe(arbitrumSepolia.network);
    expect(decoded.accepted.payTo.toLowerCase()).toBe(PAY_TO.toLowerCase());

    const auth = (decoded.payload as { authorization: Record<string, string> }).authorization;
    expect(auth.to.toLowerCase()).toBe(PAY_TO.toLowerCase());
    expect(BigInt(auth.value)).toBe(1000000n);
    expect((decoded.payload as { signature: string }).signature).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  it("passes non-402 responses through unchanged without attempting payment", async () => {
    const fetch = vi.fn(async () => new Response("hi", { status: 200 }));
    const f = createX402RssFetch({ account: ACCOUNT, fetch: fetch as never });
    const res = await f("https://example.test/free");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a payment whose amount exceeds maxValue", async () => {
    const { fetch } = mockResource("999000000"); // 999 USDC > 10 USDC cap
    const f = createX402RssFetch({ account: ACCOUNT, fetch: fetch as never, maxValue: 10_000_000n });
    await expect(f("https://example.test/job")).rejects.toThrow(/amount exceeds maxValue/);
  });

  it("rejects a payment whose asset is not the configured USDC", async () => {
    const { fetch } = mockResource("1000000", "0x1111111111111111111111111111111111111111");
    const f = createX402RssFetch({ account: ACCOUNT, fetch: fetch as never });
    await expect(f("https://example.test/job")).rejects.toThrow(/no acceptable payment requirements/);
  });

  it("rejects a non-positive payment amount", async () => {
    const { fetch } = mockResource("0");
    const f = createX402RssFetch({ account: ACCOUNT, fetch: fetch as never });
    await expect(f("https://example.test/job")).rejects.toThrow(/non-positive payment amount/);
  });
});

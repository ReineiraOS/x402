import { describe, expect, it } from "vitest";
import { createX402RssClient, type X402RssConfig } from "../src/index.js";

const config: X402RssConfig = {
  chainId: 421614,
  usdc: "0x0000000000000000000000000000000000000001",
  escrow: "0x0000000000000000000000000000000000000002",
  facilitatorUrl: "https://facilitator.example",
};

const NOT_IMPLEMENTED = "x402-rss: not implemented (A1 / DEV-189)";

describe("createX402RssClient", () => {
  it("returns a client exposing quote and settle", () => {
    const client = createX402RssClient(config);
    expect(client).toBeTypeOf("object");
    expect(client.quote).toBeTypeOf("function");
    expect(client.settle).toBeTypeOf("function");
    expect(client.config).toEqual(config);
  });

  it("rejects settle with the not-implemented error", async () => {
    const client = createX402RssClient(config);
    await expect(
      client.settle({
        payer: "0x0000000000000000000000000000000000000003",
        payee: "0x0000000000000000000000000000000000000004",
        amount: 1_000_000n,
        validAfter: 0n,
        validBefore: 0n,
        nonce: "0x00",
        signature: "0x00",
      }),
    ).rejects.toThrow(NOT_IMPLEMENTED);
  });

  it("rejects quote with the not-implemented error", async () => {
    const client = createX402RssClient(config);
    await expect(
      client.quote({
        amount: 1_000_000n,
        payee: "0x0000000000000000000000000000000000000004",
      }),
    ).rejects.toThrow(NOT_IMPLEMENTED);
  });
});

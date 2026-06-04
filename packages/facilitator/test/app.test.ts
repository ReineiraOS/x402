import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const payload = { x402Version: 2, accepted: { network: "eip155:421614" }, payload: {} };
const requirements = { scheme: "exact", network: "eip155:421614", amount: "100000" };

function fakeFacilitator(over = {}) {
  return {
    verify: async () => ({ isValid: true, payer: "0xPAYER" }),
    settle: async () => ({ success: true, transaction: "0xTX", network: "eip155:421614" }),
    ...over,
  };
}

describe("facilitator app", () => {
  it("GET /healthz -> ok", async () => {
    const res = await createApp(fakeFacilitator() as never).request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("POST /verify delegates to facilitator.verify and returns the VerifyResponse", async () => {
    const app = createApp(fakeFacilitator() as never);
    const res = await app.request("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isValid: true, payer: "0xPAYER" });
  });

  it("POST /settle delegates to facilitator.settle and returns the SettleResponse", async () => {
    const app = createApp(fakeFacilitator() as never);
    const res = await app.request("/settle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, transaction: "0xTX", network: "eip155:421614" });
  });

  it("POST /verify with a malformed body -> 400", async () => {
    const app = createApp(fakeFacilitator() as never);
    const res = await app.request("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("POST /settle with a malformed body -> 400", async () => {
    const app = createApp(fakeFacilitator() as never);
    const res = await app.request("/settle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});

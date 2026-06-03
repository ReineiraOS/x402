import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";

describe("facilitator app", () => {
  it("responds ok on /healthz", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("describes the exact scheme on /supported", async () => {
    const res = await app.request("/supported");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kinds: Array<{ scheme: string }> };
    expect(body.kinds[0]?.scheme).toBe("exact");
  });

  it("returns 501 stubs for /verify and /settle", async () => {
    const verify = await app.request("/verify", { method: "POST" });
    const settle = await app.request("/settle", { method: "POST" });
    expect(verify.status).toBe(501);
    expect(settle.status).toBe(501);
  });
});

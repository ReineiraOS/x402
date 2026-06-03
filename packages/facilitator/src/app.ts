import { ARBITRUM_SEPOLIA, X402 } from "@reineira-os/x402-rss-shared";
import { Hono } from "hono";

export const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

app.get("/supported", (c) =>
  c.json({
    x402Version: X402.version,
    kinds: [
      {
        scheme: X402.scheme,
        network: X402.network,
        asset: ARBITRUM_SEPOLIA.usdc,
      },
    ],
  }),
);

app.post("/verify", (c) =>
  c.json({ ok: false, error: "not implemented (A2 / DEV-190)" }, 501),
);

app.post("/settle", (c) =>
  c.json({ ok: false, error: "not implemented (A2 / DEV-190)" }, 501),
);

import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.FACILITATOR_PORT ?? 4021);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`x402 facilitator listening on http://localhost:${info.port}`);
});

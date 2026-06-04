import { serve } from "@hono/node-server";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "./app.js";
import { createFacilitator } from "./facilitator.js";

const port = Number(process.env.FACILITATOR_PORT ?? 4021);
const key = process.env.FACILITATOR_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) {
  throw new Error("FACILITATOR_PRIVATE_KEY is required to run the facilitator");
}
const facilitator = createFacilitator({
  account: privateKeyToAccount(key),
  rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL,
});

serve({ fetch: createApp(facilitator).fetch, port }, (info) => {
  console.log(`x402 facilitator listening on http://localhost:${info.port}`);
});

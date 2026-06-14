import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { createApp, createFacilitator } from "@reineira-os/x402-facilitator";

const key = process.env.FACILITATOR_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) {
  throw new Error("FACILITATOR_PRIVATE_KEY is required to run the facilitator");
}

const facilitator = createFacilitator({
  account: privateKeyToAccount(key),
  rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL,
});

const app = new Hono();
app.route("/", createApp(facilitator));

export default app;

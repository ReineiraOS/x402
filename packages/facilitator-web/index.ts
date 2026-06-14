import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { createApp, createFacilitator } from "@reineira-os/x402-facilitator";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

const key = process.env.FACILITATOR_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  throw new Error(
    "FACILITATOR_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key to run the facilitator",
  );
}

const facilitator = createFacilitator({
  account: privateKeyToAccount(key as `0x${string}`),
  rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL,
});

const app = new Hono();
app.route("/", createApp(facilitator));

export default app;

import { privateKeyToAccount } from "viem/accounts";
import { handle } from "hono/vercel";
import { createApp } from "../src/app.js";
import { createFacilitator } from "../src/facilitator.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

function buildApp() {
  const key = process.env.FACILITATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) {
    throw new Error("FACILITATOR_PRIVATE_KEY is required to run the facilitator");
  }
  const facilitator = createFacilitator({
    account: privateKeyToAccount(key),
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL,
  });
  return createApp(facilitator);
}

const app = buildApp();

export const GET = handle(app);
export const POST = handle(app);

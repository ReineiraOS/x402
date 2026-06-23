import { privateKeyToAccount } from "viem/accounts";
import { X402 } from "@reineira-os/x402-rss-shared";
import { createX402RssFetch } from "@reineira-os/x402-rss";

const RESOURCE_URL = process.env.RESOURCE_URL ?? "http://localhost:3000/api/resource";
// Standard publicly-known Anvil/Hardhat test account #1 — throwaway demo default, NEVER fund.
const ANVIL_TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const BUYER_PRIVATE_KEY = (process.env.BUYER_PRIVATE_KEY ?? ANVIL_TEST_KEY) as `0x${string}`;

async function main() {
  if (BUYER_PRIVATE_KEY === ANVIL_TEST_KEY) {
    console.warn(
      "[buyer-agent] WARNING: using the well-known public Anvil test key — set BUYER_PRIVATE_KEY for any non-local run.",
    );
  }
  const account = privateKeyToAccount(BUYER_PRIVATE_KEY);
  const fetchPaid = createX402RssFetch({ account });

  console.log(
    `[buyer-agent] GET ${RESOURCE_URL} (x402 v${X402.version}, payer ${account.address})`,
  );
  const res = await fetchPaid(RESOURCE_URL);

  const body = await res.json();
  console.log(`[buyer-agent] ${res.status} ${res.status === 200 ? "PAID" : ""}`);
  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => {
  console.error("[buyer-agent] error:", err);
  process.exitCode = 1;
});

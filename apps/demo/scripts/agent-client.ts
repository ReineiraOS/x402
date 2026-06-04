import { X402 } from "@reineira-os/x402-rss-shared";

const RESOURCE_URL = process.env.RESOURCE_URL ?? "http://localhost:3000/api/resource";

async function main() {
  console.log(`[buyer-agent] GET ${RESOURCE_URL}`);
  const res = await fetch(RESOURCE_URL);

  if (res.status === 402) {
    const challenge = await res.json();
    console.log(`[buyer-agent] 402 PAYMENT REQUIRED (x402 v${X402.version})`);
    console.log(JSON.stringify(challenge, null, 2));

    // STUB: EIP-3009 receiveWithAuthorization signing + retry-with-x-payment lands in A1 / B (DEV-189/DEV-194)
    console.log("[buyer-agent] signing + retry-with-payment not implemented yet (A1/B)");
    return;
  }

  const body = await res.json();
  console.log(`[buyer-agent] ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => {
  console.error("[buyer-agent] error:", err);
  process.exitCode = 1;
});

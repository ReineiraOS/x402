import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  publicActions,
  getAddress,
  type Hex,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { escrowAbi } from "@reineira-os/x402-rss-shared";
import { ExactEvmScheme } from "@reineira-os/x402-core/exact/client";
import { settleExact, toFacilitatorEvmSigner } from "@reineira-os/x402-core/exact/settle";
import type { PaymentPayload, PaymentRequirements } from "@reineira-os/x402-core/types";
import { createAgentWallet } from "../lib/agentWallet";
import {
  createEscrowForSale,
  getSellerEscrowConfig,
  isEscrowFunded,
} from "../lib/sellerEscrow";

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

const PRICE = 100_000n;
const USDC = getAddress("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usdc = (v: bigint) => `${(Number(v) / 1e6).toFixed(2)} USDC`;
const arbiscan = (tx: string) => `https://sepolia.arbiscan.io/tx/${tx}`;

async function main() {
  loadEnv();
  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });

  const config = getSellerEscrowConfig();
  if (!config) throw new Error("seller escrow config missing (check .env.local)");

  // 1. Agent smart wallet
  console.log("\n=== 1. Agent smart wallet (ZeroDev Kernel) ===");
  const wallet = await createAgentWallet(process.env.AGENT_PRIVATE_KEY as Hex);
  console.log("kernel address:", wallet.address);
  const dep = await wallet.deployIfNeeded();
  console.log("deployed:", dep.deployedNow ? `now (${dep.txHash})` : "already");
  const agentBalBefore = await wallet.usdcBalance();
  console.log("agent USDC:", usdc(agentBalBefore));
  if (agentBalBefore < PRICE) throw new Error(`agent Kernel underfunded; faucet USDC to ${wallet.address}`);

  // 2. Seller opens a plugin-gated escrow for this sale
  console.log("\n=== 2. Seller opens escrow (TimeLock-gated) ===");
  const issued = await createEscrowForSale(config, PRICE);
  console.log("escrowId:", issued.extra.escrowId, "| deadline:", new Date(issued.deadline * 1000).toISOString());
  console.log("create tx:", arbiscan(issued.txHash));

  // 3. Agent signs the x402 payment (ReceiveWithAuthorization, nonce bound to escrowId)
  console.log("\n=== 3. Agent signs escrow-bound x402 payment ===");
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: "eip155:421614",
    amount: PRICE.toString(),
    asset: USDC,
    payTo: issued.extra.receiver,
    maxTimeoutSeconds: 120,
    extra: { name: "USD Coin", version: "2", escrow: issued.extra },
  };
  const scheme = new ExactEvmScheme(wallet.signer);
  const partial = await scheme.createPaymentPayload(2, requirements);
  const payment: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: partial.payload as unknown as Record<string, unknown>,
  };
  console.log("signed ✓ (nonce bound to escrow", issued.extra.escrowId + ")");

  // 4. Facilitator verifies (ERC-1271) + settles into the escrow
  console.log("\n=== 4. Facilitator settles into escrow (real tx) ===");
  const facilitatorAccount = privateKeyToAccount(process.env.FACILITATOR_PRIVATE_KEY as Hex);
  const facilitatorWallet = createWalletClient({
    account: facilitatorAccount,
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  }).extend(publicActions);
  const facilitatorSigner = toFacilitatorEvmSigner(
    Object.assign(facilitatorWallet, { address: facilitatorAccount.address }) as never,
  );
  const settle = await settleExact(payment, requirements, {
    signer: facilitatorSigner,
    publicClient,
  });
  if (!settle.success) throw new Error(`settle failed: ${settle.errorReason} ${settle.errorMessage ?? ""}`);
  console.log("settle tx:", arbiscan(settle.transaction!));

  // 5. Escrow funded?
  const escrowId = BigInt(issued.extra.escrowId);
  const funded = await isEscrowFunded(config, escrowId);
  const agentBalAfter = await wallet.usdcBalance();
  console.log("\n=== 5. Escrow state ===");
  console.log("isFunded:", funded);
  console.log("agent USDC: ", usdc(agentBalBefore), "->", usdc(agentBalAfter), "(paid", usdc(agentBalBefore - agentBalAfter) + ")");
  if (!funded) throw new Error("escrow not funded after settle");

  // 6. Wait for the TimeLock deadline, then seller redeems
  console.log("\n=== 6. Wait for TimeLock, seller redeems ===");
  const waitMs = Math.max(0, issued.deadline * 1000 - Date.now()) + 8000;
  console.log(`waiting ${Math.round(waitMs / 1000)}s for deadline...`);
  await sleep(waitMs);
  const seller = privateKeyToAccount(config.sellerKey);
  const sellerBefore = (await publicClient.readContract({
    address: USDC, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }] }], functionName: "balanceOf", args: [seller.address],
  })) as bigint;
  const sellerWallet = createWalletClient({ account: seller, chain: arbitrumSepolia, transport: http(rpcUrl) });
  const { request } = await publicClient.simulateContract({
    account: seller, address: config.escrow, abi: escrowAbi, functionName: "redeem", args: [escrowId],
  });
  const redeemTx = await sellerWallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: redeemTx });
  const sellerAfter = (await publicClient.readContract({
    address: USDC, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }] }], functionName: "balanceOf", args: [seller.address],
  })) as bigint;
  console.log("redeem tx:", arbiscan(redeemTx));
  console.log("seller USDC:", usdc(sellerBefore), "->", usdc(sellerAfter), "(+", usdc(sellerAfter - sellerBefore) + ")");

  console.log("\n=== E2E PASSED ✓ — agent paid into escrow, seller redeemed after TimeLock ===");
}

main().catch((err) => {
  console.error("\nE2E FAILED:", err);
  process.exit(1);
});

import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits, getAddress } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { ARBITRUM_SEPOLIA, X402, erc3009Abi } from "@reineira-os/x402-rss-shared";
import { toClientEvmSigner, ExactEvmScheme } from "@reineira-os/x402-core/exact/client";
import type { PaymentPayload, PaymentRequirements } from "@reineira-os/x402-core/types";
import { createFacilitator } from "../src/facilitator.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main() {
  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL;
  const buyer = privateKeyToAccount(required("BUYER_PRIVATE_KEY") as `0x${string}`);
  const facilitatorAccount = privateKeyToAccount(required("FACILITATOR_PRIVATE_KEY") as `0x${string}`);

  const usdc = getAddress(ARBITRUM_SEPOLIA.usdc);
  const payTo = facilitatorAccount.address; // provider = facilitator address, so we can see buyer -> provider
  const amount = process.env.AMOUNT ?? "100000"; // 0.1 USDC (6 decimals)

  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });

  const readUsdc = (account: `0x${string}`) =>
    publicClient.readContract({ address: usdc, abi: erc3009Abi, functionName: "balanceOf", args: [account] }) as Promise<bigint>;

  console.log("chain:", await publicClient.getChainId());
  console.log("buyer:", buyer.address);
  console.log("provider (payTo):", payTo);

  const facilitatorEth = await publicClient.getBalance({ address: facilitatorAccount.address });
  const buyerUsdcBefore = await readUsdc(buyer.address);
  const payToUsdcBefore = await readUsdc(payTo);
  console.log("facilitator ETH:", formatUnits(facilitatorEth, 18));
  console.log("buyer USDC:", formatUnits(buyerUsdcBefore, 6));
  if (facilitatorEth === 0n) throw new Error("facilitator has 0 ETH — fund it for gas");
  if (buyerUsdcBefore < BigInt(amount)) throw new Error(`buyer USDC ${buyerUsdcBefore} < amount ${amount} — fund the buyer`);

  const requirements: PaymentRequirements = {
    scheme: X402.scheme,
    network: X402.network,
    asset: usdc,
    amount,
    payTo,
    maxTimeoutSeconds: 120,
    extra: { name: X402.eip712.name, version: X402.eip712.version },
  };

  // BUYER signs a real EIP-3009 authorization (off-chain, gasless)
  const scheme = new ExactEvmScheme(toClientEvmSigner(buyer, publicClient));
  const partial = await scheme.createPaymentPayload(X402.version, requirements);
  const payload: PaymentPayload = {
    x402Version: partial.x402Version,
    accepted: requirements,
    payload: partial.payload as unknown as Record<string, unknown>,
  };

  // FACILITATOR verifies, then settles on-chain (pays gas)
  const facilitator = createFacilitator({ account: facilitatorAccount, rpcUrl });

  const verify = await facilitator.verify(payload, requirements);
  console.log("verify:", verify);
  if (!verify.isValid) throw new Error(`verify failed: ${verify.invalidReason}`);

  const settle = await facilitator.settle(payload, requirements);
  console.log("settle:", settle);
  if (!settle.success) throw new Error(`settle failed: ${settle.errorReason}`);

  const buyerUsdcAfter = await readUsdc(buyer.address);
  const payToUsdcAfter = await readUsdc(payTo);
  console.log("buyer USDC:", formatUnits(buyerUsdcBefore, 6), "->", formatUnits(buyerUsdcAfter, 6));
  console.log("provider USDC:", formatUnits(payToUsdcBefore, 6), "->", formatUnits(payToUsdcAfter, 6));
  console.log("Arbiscan:", `https://sepolia.arbiscan.io/tx/${settle.transaction}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

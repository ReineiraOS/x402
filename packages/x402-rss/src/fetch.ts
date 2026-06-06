import { createPublicClient, http, type LocalAccount } from "viem";
import { arbitrumSepolia as arbitrumSepoliaChain } from "viem/chains";
import { wrapFetchWithPayment, x402Client, type SelectPaymentRequirements } from "@reineira-os/x402-core/exact/client";
import { ExactEvmScheme, toClientEvmSigner } from "@reineira-os/x402-core/exact/client";
import { arbitrumSepolia } from "./config.js";

export interface CreateX402RssFetchOptions {
  account: LocalAccount;
  fetch?: typeof fetch;
  maxValue?: bigint;
  rpcUrl?: string;
}

export function createX402RssFetch(opts: CreateX402RssFetchOptions): typeof fetch {
  const publicClient = createPublicClient({
    chain: arbitrumSepoliaChain,
    transport: http(opts.rpcUrl),
  });
  const signer = toClientEvmSigner(opts.account, publicClient);
  const maxValue = opts.maxValue ?? arbitrumSepolia.defaultMaxValue;

  const selectWithinMaxValue: SelectPaymentRequirements = (_x402Version, requirements) => {
    const chosen = requirements.find(
      (r) =>
        r.scheme === arbitrumSepolia.scheme &&
        r.network === arbitrumSepolia.network &&
        r.asset.toLowerCase() === arbitrumSepolia.usdc.toLowerCase(),
    );
    if (!chosen) {
      throw new Error("x402-rss: no acceptable payment requirements (exact / eip155:421614 / USDC)");
    }
    if (!/^[0-9]+$/.test(chosen.amount)) {
      throw new Error("x402-rss: malformed payment amount");
    }
    const amount = BigInt(chosen.amount);
    if (amount <= 0n) {
      throw new Error("x402-rss: non-positive payment amount");
    }
    if (amount > maxValue) {
      throw new Error("x402-rss: amount exceeds maxValue");
    }
    return chosen;
  };

  const client = new x402Client(selectWithinMaxValue).register(
    arbitrumSepolia.network,
    new ExactEvmScheme(signer),
  );

  const baseFetch = opts.fetch ?? fetch;
  return wrapFetchWithPayment(baseFetch, client) as typeof fetch;
}

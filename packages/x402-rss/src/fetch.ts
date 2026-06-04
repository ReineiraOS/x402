import { createPublicClient, http, type LocalAccount } from "viem";
import { arbitrumSepolia as arbitrumSepoliaChain } from "viem/chains";
import { wrapFetchWithPayment, x402Client, type SelectPaymentRequirements } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
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
    const chosen =
      requirements.find(
        (r) => r.scheme === arbitrumSepolia.scheme && r.network === arbitrumSepolia.network,
      ) ?? requirements[0];
    if (!chosen) {
      throw new Error("x402-rss: no acceptable payment requirements");
    }
    if (BigInt(chosen.amount) > maxValue) {
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

import { createWalletClient, http, publicActions, type LocalAccount } from "viem";
import { arbitrumSepolia as arbitrumSepoliaChain } from "viem/chains";
import { X402Facilitator, registerExactEvmScheme } from "@reineira-os/x402-core/facilitator";
import {
  toFacilitatorEvmSigner,
  type FacilitatorEvmSigner,
} from "@reineira-os/x402-core/exact/settle";
import { X402 } from "@reineira-os/x402-shared";

export interface CreateFacilitatorOptions {
  account: LocalAccount;
  rpcUrl?: string;
}

export function createFacilitator(opts: CreateFacilitatorOptions): X402Facilitator {
  const wallet = createWalletClient({
    account: opts.account,
    chain: arbitrumSepoliaChain,
    transport: http(opts.rpcUrl),
  }).extend(publicActions);
  const adapted = Object.assign(wallet, {
    address: opts.account.address,
  }) as unknown as Omit<FacilitatorEvmSigner, "getAddresses"> & { address: `0x${string}` };
  const signer = toFacilitatorEvmSigner(adapted);
  const facilitator = new X402Facilitator();
  registerExactEvmScheme(facilitator, { signer, networks: X402.network });
  return facilitator;
}

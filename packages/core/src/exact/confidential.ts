import type { Hex, PublicClient, WalletClient } from "viem";
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { arbSepolia } from "@cofhe/sdk/chains";
import { WagmiAdapter } from "@cofhe/sdk/adapters";
import { PermitUtils } from "@cofhe/sdk/permits";

export type EncryptedInput = {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: Hex;
};

export type ConfidentialClient = {
  raw: ReturnType<typeof createCofheClient>;
  account: `0x${string}`;
  chainId: number;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

export async function createConfidentialClient(opts: {
  walletClient: WalletClient;
  publicClient: PublicClient;
}): Promise<ConfidentialClient> {
  const raw = createCofheClient(createCofheConfig({ supportedChains: [arbSepolia] }));
  await WagmiAdapter(opts.walletClient, opts.publicClient);
  await raw.connect(opts.publicClient, opts.walletClient);
  const account = opts.walletClient.account!.address;
  const chainId = await opts.publicClient.getChainId();
  return {
    raw,
    account,
    chainId,
    publicClient: opts.publicClient,
    walletClient: opts.walletClient,
  };
}

export async function encryptUint64(c: ConfidentialClient, value: bigint): Promise<EncryptedInput> {
  const result = await c.raw
    .encryptInputs([Encryptable.uint64(value)])
    .setAccount(c.account)
    .setChainId(c.chainId)
    .execute();
  return result[0] as EncryptedInput;
}

export async function encryptAddress(
  c: ConfidentialClient,
  addr: `0x${string}`,
): Promise<EncryptedInput> {
  const result = await c.raw
    .encryptInputs([Encryptable.address(addr)])
    .setAccount(c.account)
    .setChainId(c.chainId)
    .execute();
  return result[0] as EncryptedInput;
}

export async function decryptUint64(c: ConfidentialClient, ctHash: bigint): Promise<bigint> {
  const permit = await PermitUtils.createSelfAndSign(
    { issuer: c.account, expiration: Math.floor(Date.now() / 1000) + 86_400 },
    c.publicClient,
    c.walletClient,
  );
  const value = await c.raw.decryptForView(ctHash, FheTypes.Uint64).withPermit(permit).execute();
  return BigInt(value as bigint | number | string);
}

export const confidential = {
  createConfidentialClient,
  encryptUint64,
  encryptAddress,
  decryptUint64,
} as const;

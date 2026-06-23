import { createPublicClient, createWalletClient, getAddress, http, type PublicClient, type WalletClient } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createConfidentialClient, type ConfidentialClient } from "@reineira-os/x402-core";

export interface ConfidentialConfig {
  escrow: `0x${string}`;
  receiver: `0x${string}`;
  coverageManager: `0x${string}`;
  policy: `0x${string}`;
  pool: `0x${string}`;
  resolver: `0x${string}`;
  cusdc: `0x${string}`;
  sellerAddress: `0x${string}`;
  sellerKey: `0x${string}`;
  rpcUrl: string;
}

function envAddr(name: string): `0x${string}` | null {
  const v = process.env[name];
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? getAddress(v) : null;
}

export function getConfidentialConfig(): ConfidentialConfig | null {
  const escrow = envAddr("CONFIDENTIAL_ESCROW_ADDRESS");
  const receiver = envAddr("CONFIDENTIAL_X402_RECEIVER_ADDRESS");
  const coverageManager = envAddr("CONFIDENTIAL_COVERAGE_MANAGER_ADDRESS");
  const policy = envAddr("CONFIDENTIAL_DELIVERY_POLICY_ADDRESS");
  const pool = envAddr("CONFIDENTIAL_POOL_ADDRESS");
  const resolver = envAddr("DELIVERY_DEADLINE_RESOLVER_ADDRESS");
  const cusdc = envAddr("CONFIDENTIAL_USDC_ADDRESS");
  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL ?? "";
  const sellerKey = process.env.SELLER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!escrow || !receiver || !coverageManager || !policy || !pool || !resolver || !cusdc || !rpcUrl || !sellerKey) {
    return null;
  }
  const sellerAddress = privateKeyToAccount(sellerKey).address;
  return { escrow, receiver, coverageManager, policy, pool, resolver, cusdc, sellerAddress, sellerKey, rpcUrl };
}

export function confidentialClients(cfg: ConfidentialConfig): { publicClient: PublicClient; walletClient: WalletClient } {
  const account = privateKeyToAccount(cfg.sellerKey);
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(cfg.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(cfg.rpcUrl) });
  return { publicClient, walletClient };
}

export async function sellerFheClient(cfg: ConfidentialConfig): Promise<{ fhe: ConfidentialClient; publicClient: PublicClient; walletClient: WalletClient }> {
  const { publicClient, walletClient } = confidentialClients(cfg);
  const fhe = await createConfidentialClient({ walletClient, publicClient });
  return { fhe, publicClient, walletClient };
}

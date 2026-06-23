import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  createConfidentialClient,
  createConfidentialEscrow,
  readConfidentialAmount,
  purchaseConfidentialCoverage,
  getCoverageStatus,
} from "@reineira-os/x402-core";

const RPC = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
const KEY = process.env.SELLER_PRIVATE_KEY as `0x${string}`;
const ESCROW = getAddress(process.env.CONFIDENTIAL_ESCROW_ADDRESS!);
const RESOLVER = getAddress(process.env.DELIVERY_DEADLINE_RESOLVER_ADDRESS!);
const CM = getAddress(process.env.CONFIDENTIAL_COVERAGE_MANAGER_ADDRESS!);
const POOL = getAddress(process.env.CONFIDENTIAL_POOL_ADDRESS!);
const POLICY = getAddress(process.env.CONFIDENTIAL_DELIVERY_POLICY_ADDRESS!);

async function main() {
  if (process.env.RUN_LIVE_FHE !== "1") {
    console.log("set RUN_LIVE_FHE=1 to run the live confidential data-buy e2e");
    return;
  }
  const account = privateKeyToAccount(KEY);
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport: http(RPC) });
  const fhe = await createConfidentialClient({ walletClient, publicClient });
  const viem = { publicClient, walletClient };

  const amount = 100000n;
  const { escrowId } = await createConfidentialEscrow(fhe, viem, {
    escrow: ESCROW, owner: account.address, amount, resolver: RESOLVER, resolverData: "0x",
  });
  console.log(`escrow ${escrowId} created`);

  const dec = await readConfidentialAmount(fhe, viem, { escrow: ESCROW, escrowId });
  if (dec !== amount) throw new Error(`escrow decrypt mismatch: ${dec} != ${amount}`);
  console.log(`escrow amount decrypt OK (${dec})`);

  const expiry = BigInt(Number((await publicClient.getBlock()).timestamp) + 3600);
  const { coverageId } = await purchaseConfidentialCoverage(fhe, viem, {
    coverageManager: CM, pool: POOL, policy: POLICY, escrowId,
    holder: account.address, amount, expiry,
  });
  const status = await getCoverageStatus(viem, { coverageManager: CM, coverageId });
  console.log(`coverage ${coverageId} status=${status}`);
  console.log("CONFIDENTIAL DATA-BUY E2E: PASS");
}

main().catch((e) => { console.error(e); process.exit(1); });

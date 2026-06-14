import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  type Hex,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { coverageManagerAbi, deliveryResolverAbi } from "../lib/coverage";

function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const RPC = process.env.ARBITRUM_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";
const CM = getAddress(process.env.COVERAGE_MANAGER_ADDRESS!);
const POLICY = getAddress(process.env.DELIVERY_POLICY_ADDRESS!);
const RESOLVER = getAddress(process.env.DELIVERY_DEADLINE_RESOLVER_ADDRESS!);
const POOL = getAddress(process.env.COVERAGE_POOL_ADDRESS!);
const ESCROW = getAddress(process.env.ESCROW_ADDRESS!);
const USDC = getAddress("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
const sellerKey = process.env.SELLER_PRIVATE_KEY! as Hex;
const seller = privateKeyToAccount(sellerKey);

const escrowCreateAbi = [
  {
    type: "function",
    name: "create",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "resolver", type: "address" },
      { name: "resolverData", type: "bytes" },
    ],
    outputs: [{ name: "escrowId", type: "uint256" }],
  },
  {
    type: "function",
    name: "total",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const poolAbi = [
  { type: "function", name: "isPolicy", stateMutability: "view", inputs: [{ name: "p", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "totalLiquidity", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const;

const pc = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC) });
const wc = createWalletClient({ account: seller, chain: arbitrumSepolia, transport: http(RPC) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (b: boolean) => (b ? "✓" : "✗");

async function check() {
  console.log("── addresses & wiring ──");
  const [resEscrow, polCM, isPol, liq] = await Promise.all([
    pc.readContract({ address: RESOLVER, abi: [{ type: "function", name: "escrow", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }], functionName: "escrow" }),
    pc.readContract({ address: POLICY, abi: [{ type: "function", name: "coverageManager", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }], functionName: "coverageManager" }),
    pc.readContract({ address: POOL, abi: poolAbi, functionName: "isPolicy", args: [POLICY] }),
    pc.readContract({ address: POOL, abi: poolAbi, functionName: "totalLiquidity" }),
  ]);
  console.log(`  ${ok(getAddress(resEscrow as string) === ESCROW)} resolver.escrow == demo escrow`);
  console.log(`  ${ok(getAddress(polCM as string) === CM)} policy.coverageManager == CoverageManager`);
  console.log(`  pool.isPolicy(DeliveryPolicy) = ${isPol}  (needs owner registerPolicy + addPolicy)`);
  console.log(`  pool.totalLiquidity = ${(Number(liq) / 1e6).toFixed(2)} USDC  (needs stake for non-zero payout)`);

  console.log("\n── readiness (both must be true after owner setup) ──");
  const slot = await pc.getStorageAt({ address: ESCROW, slot: "0x2" });
  const im = slot ? getAddress(`0x${slot.slice(-40)}`) : null;
  console.log(`  insuranceManager set = ${im === CM} (current: ${im})`);
  console.log(`  policy allow-listed  = ${isPol}`);

  console.log("\n── purchaseCoverage simulation (proves only blocker is owner setup) ──");
  const policyData = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [RESOLVER, 1n]);
  try {
    await pc.simulateContract({
      account: seller,
      address: CM,
      abi: coverageManagerAbi,
      functionName: "purchaseCoverage",
      args: [seller.address, POOL, POLICY, 1n, 100000n, BigInt(Math.floor(Date.now() / 1000) + 3600), policyData, "0x"],
    });
    console.log("  ⚠ simulation SUCCEEDED — owner setup already applied? Coverage is purchasable now.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const blocker = /NotInsuranceManager|InvalidPolicy|reverted/i.test(msg);
    console.log(`  ${ok(blocker)} reverts as expected pre-setup (${(msg.split("\n").find((l) => /Error:|reverted|0x/.test(l)) ?? msg).trim().slice(0, 90)})`);
  }
}

async function chainNow(): Promise<bigint> {
  const b = await pc.getBlock({ blockTag: "latest" });
  return b.timestamp;
}

async function resolverE2E() {
  console.log("\n── resolver leg (ownerless: create delivery escrow → attest → breach) ──");
  // happy: deadline 10 min out (off the chain clock, not local), attest, expect delivered
  const ts1 = await chainNow();
  const dataOk = encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [ts1 + 600n, seller.address]);
  const { request: c1, result: id1 } = await pc.simulateContract({ account: seller, address: ESCROW, abi: escrowCreateAbi, functionName: "create", args: [seller.address, 100000n, RESOLVER, dataOk] });
  const t1 = await wc.writeContract(c1); await pc.waitForTransactionReceipt({ hash: t1 });
  const eid1 = id1 as bigint;
  const configured = await pc.readContract({ address: RESOLVER, abi: deliveryResolverAbi, functionName: "isConfigured", args: [eid1] });
  console.log(`  escrow #${eid1} created with delivery resolver · isConfigured=${configured}`);
  const { request: a1 } = await pc.simulateContract({ account: seller, address: RESOLVER, abi: deliveryResolverAbi, functionName: "attestDelivery", args: [eid1] });
  const ta = await wc.writeContract(a1); await pc.waitForTransactionReceipt({ hash: ta });
  const delivered = await pc.readContract({ address: RESOLVER, abi: deliveryResolverAbi, functionName: "isDelivered", args: [eid1] });
  console.log(`  ${ok(!!delivered)} attestDelivery → isDelivered=${delivered} (happy path: redeemable)`);

  // breach: short deadline off the chain clock, no attest, expect isBreached after it passes
  const ts2 = await chainNow();
  const dataBreach = encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [ts2 + 12n, seller.address]);
  const { request: c2, result: id2 } = await pc.simulateContract({ account: seller, address: ESCROW, abi: escrowCreateAbi, functionName: "create", args: [seller.address, 100000n, RESOLVER, dataBreach] });
  const t2 = await wc.writeContract(c2); await pc.waitForTransactionReceipt({ hash: t2 });
  const eid2 = id2 as bigint;
  console.log(`  escrow #${eid2} created (deadline ${ts2 + 12n}, no attestation) — waiting for breach…`);
  let breached = false;
  for (let i = 0; i < 12 && !breached; i++) {
    await sleep(3000);
    breached = (await pc.readContract({ address: RESOLVER, abi: deliveryResolverAbi, functionName: "isBreached", args: [eid2] })) as boolean;
  }
  console.log(`  ${ok(breached)} isBreached=${breached} (breach path: buyer can claim)`);
}

const mode = process.argv[2] ?? "check";
(async () => {
  await check();
  if (mode === "resolver") await resolverE2E();
  console.log("\ndone.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

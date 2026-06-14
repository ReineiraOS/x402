/**
 * Standalone on-chain proof of the Two-Key Halt mechanic on Arbitrum Sepolia.
 * Proves the NEW, previously-unproven surface end-to-end with three distinct keys:
 *   bond create (backend) -> bond fund (Sentinel) -> staged demoDrain -> Guardian pause ->
 *   AlertResolver verdict flips false->true -> Sentinel redeems the bond back.
 * Run: tsx scripts/twokey-proof.ts   (env vars supplied by the caller)
 */
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  parseEventLogs,
  keccak256,
  toHex,
  type Hex,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC!;
const ESCROW = getAddress(process.env.ESCROW_ADDRESS!);
const VAULT = getAddress(process.env.VAULT_ADDRESS!);
const RESOLVER = getAddress(process.env.ALERT_RESOLVER_ADDRESS!);
const USDC = getAddress(process.env.USDC_ADDRESS!);
const BACKEND_KEY = process.env.BACKEND_KEY as Hex;
const GUARDIAN_KEY = process.env.GUARDIAN_KEY as Hex;
const SENTINEL_KEY = process.env.SENTINEL_KEY as Hex;
const BOND = 1_000_000n; // 1 USDC
const DRAIN = 600_000n;

const vaultAbi = [
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "recordedFloor", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isHealthy", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "a", type: "uint256" }], outputs: [] },
  { type: "function", name: "demoDrain", stateMutability: "nonpayable", inputs: [{ name: "a", type: "uint256" }], outputs: [] },
  { type: "function", name: "pause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "unpause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "hasRole", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "bool" }] },
] as const;

const resolverAbi = [
  { type: "function", name: "isConditionMet", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isBreached", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "floorOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sentinelOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
] as const;

const escrowAbi = [
  { type: "function", name: "create", stateMutability: "nonpayable", inputs: [{ name: "owner_", type: "address" }, { name: "amount_", type: "uint256" }, { name: "resolver", type: "address" }, { name: "resolverData", type: "bytes" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "fund", stateMutability: "nonpayable", inputs: [{ name: "escrowId", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "redeem", stateMutability: "nonpayable", inputs: [{ name: "escrowId", type: "uint256" }], outputs: [] },
  { type: "function", name: "getOwner", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getPaidAmount", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getConditionResolver", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "event", name: "EscrowCreated", inputs: [{ name: "escrowId", type: "uint256", indexed: true }] },
] as const;

const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const pub = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC) });
const backend = privateKeyToAccount(BACKEND_KEY);
const guardian = privateKeyToAccount(GUARDIAN_KEY);
const sentinel = privateKeyToAccount(SENTINEL_KEY);
const wallet = (acct: typeof backend) => createWalletClient({ account: acct, chain: arbitrumSepolia, transport: http(RPC) });

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}
async function send(acct: typeof backend, params: Parameters<typeof pub.simulateContract>[0]) {
  const { request } = await pub.simulateContract({ ...params, account: acct } as never);
  const hash = await wallet(acct).writeContract(request as never);
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`tx reverted ${hash}`);
  return { hash, rcpt };
}

async function main() {
  console.log("Two-Key Halt — on-chain proof (Arbitrum Sepolia)\n");
  console.log("backend :", backend.address);
  console.log("guardian:", guardian.address);
  console.log("sentinel:", sentinel.address, "\n");

  const PAUSER_ROLE = keccak256(toHex("PAUSER_ROLE"));
  const DEMO_ROLE = keccak256(toHex("DEMO_ROLE"));

  console.log("STEP 0 — roles + healthy vault");
  assert(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "hasRole", args: [PAUSER_ROLE, guardian.address] }), "Guardian holds PAUSER_ROLE");
  assert(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "hasRole", args: [DEMO_ROLE, backend.address] }), "Backend holds DEMO_ROLE");
  assert(!(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "hasRole", args: [PAUSER_ROLE, sentinel.address] })), "Sentinel does NOT hold PAUSER_ROLE (two-key separation)");
  // ensure healthy at start (restore from any prior run)
  const ta0 = (await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "totalAssets" })) as bigint;
  const fl0 = (await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "recordedFloor" })) as bigint;
  if (ta0 < fl0) {
    await send(backend, { address: VAULT, abi: vaultAbi, functionName: "deposit", args: [fl0 - ta0] });
  }
  if (await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "paused" })) {
    await send(guardian, { address: VAULT, abi: vaultAbi, functionName: "unpause", args: [] });
  }
  assert(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "isHealthy" }), "vault healthy at start");

  console.log("\nSTEP 1 — Sentinel stakes a bond into an AlertResolver-gated escrow");
  const created = await send(backend, { address: ESCROW, abi: escrowAbi, functionName: "create", args: [sentinel.address, BOND, RESOLVER, encodeAbiParameters([{ type: "address" }], [sentinel.address])] });
  const ev = parseEventLogs({ abi: escrowAbi, eventName: "EscrowCreated", logs: created.rcpt.logs })[0];
  const escrowId = ev.args.escrowId as bigint;
  console.log(`  bond escrow #${escrowId} created — tx ${created.hash}`);
  assert(getAddress((await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getConditionResolver", args: [escrowId] })) as string) === RESOLVER, "escrow resolver == AlertResolver");
  assert(getAddress((await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getOwner", args: [escrowId] })) as string) === getAddress(sentinel.address), "bond owner == Sentinel");
  assert(((await pub.readContract({ address: RESOLVER, abi: resolverAbi, functionName: "floorOf", args: [escrowId] })) as bigint) === fl0, "resolver snapshotted vault floor");
  assert(!(await pub.readContract({ address: RESOLVER, abi: resolverAbi, functionName: "isConditionMet", args: [escrowId] })), "verdict false while vault healthy (false alarm would lock bond)");

  await send(sentinel, { address: USDC, abi: erc20Abi, functionName: "approve", args: [ESCROW, BOND] });
  const funded = await send(sentinel, { address: ESCROW, abi: escrowAbi, functionName: "fund", args: [escrowId, BOND] });
  console.log(`  bond funded ${Number(BOND) / 1e6} USDC — tx ${funded.hash}`);
  assert(((await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getPaidAmount", args: [escrowId] })) as bigint) >= BOND, "bond fully funded on-chain");

  console.log("\nSTEP 2 — staged attacker drains the vault below its floor (one real on-chain write)");
  const drained = await send(backend, { address: VAULT, abi: vaultAbi, functionName: "demoDrain", args: [DRAIN] });
  console.log(`  demoDrain — tx ${drained.hash}`);
  assert(!(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "isHealthy" })), "vault invariant broken (totalAssets < floor)");

  console.log("\nSTEP 3 — Guardian (distinct key) pauses the vault, freezing further damage");
  const paused = await send(guardian, { address: VAULT, abi: vaultAbi, functionName: "pause", args: [] });
  console.log(`  vault paused — tx ${paused.hash}`);
  assert(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "paused" }), "vault PAUSED · funds safe");

  console.log("\nSTEP 4 — trustless verdict: AlertResolver reads the real breached flag");
  assert(await pub.readContract({ address: RESOLVER, abi: resolverAbi, functionName: "isBreached", args: [escrowId] }), "AlertResolver.isBreached == true (VALID)");
  assert(await pub.readContract({ address: RESOLVER, abi: resolverAbi, functionName: "isConditionMet", args: [escrowId] }), "isConditionMet == true → bond redeemable");

  console.log("\nSTEP 5 — Sentinel redeems the bond back (condition met)");
  const balBefore = (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [sentinel.address] })) as bigint;
  const redeemed = await send(sentinel, { address: ESCROW, abi: escrowAbi, functionName: "redeem", args: [escrowId] });
  const balAfter = (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [sentinel.address] })) as bigint;
  console.log(`  bond redeemed — tx ${redeemed.hash}`);
  assert(balAfter > balBefore, `Sentinel got the bond back (+${Number(balAfter - balBefore) / 1e6} USDC)`);

  console.log("\nSTEP 6 — Guardian restores the vault for the next run");
  await send(guardian, { address: VAULT, abi: vaultAbi, functionName: "unpause", args: [] });
  await send(backend, { address: VAULT, abi: vaultAbi, functionName: "deposit", args: [DRAIN] });
  assert(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "isHealthy" }), "vault healthy again");

  console.log("\n✅ TWO-KEY HALT PROOF PASSED — every step is a real Arb Sepolia tx");
  console.log(JSON.stringify({
    bondCreate: created.hash, bondFund: funded.hash, guardianPause: paused.hash,
    stagedDrain: drained.hash, bondRedeem: redeemed.hash, escrowId: escrowId.toString(),
  }, null, 2));
}

main().catch((e) => { console.error("\n❌ PROOF FAILED:", e.message); process.exit(1); });

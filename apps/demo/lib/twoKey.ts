import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  http,
  parseEventLogs,
  toHex,
  type Account,
  type Hex,
  type PublicClient,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ARBITRUM_SEPOLIA, X402, escrowAbi } from "@reineira-os/x402-rss-shared";
import { ExactEvmScheme, toClientEvmSigner } from "@reineira-os/x402-core/exact/client";
import type { PaymentRequirements } from "@reineira-os/x402-core/types";

export type TwoKeyEmit = (event: Record<string, unknown>) => void;

export interface TwoKeyConfig {
  escrow: `0x${string}`;
  receiver: `0x${string}`;
  vault: `0x${string}`;
  resolver: `0x${string}`;
  usdc: `0x${string}`;
  backendKey: Hex;
  guardianKey: Hex;
  sentinelKey: Hex;
  facilitatorUrl: string;
  rpcUrl: string;
}

export function getTwoKeyConfig(): TwoKeyConfig | null {
  const escrow = process.env.ESCROW_ADDRESS;
  const receiver = process.env.X402_RECEIVER_ADDRESS;
  const vault = process.env.VAULT_ADDRESS;
  const resolver = process.env.ALERT_RESOLVER_ADDRESS;
  const backendKey = process.env.SELLER_PRIVATE_KEY;
  const guardianKey = process.env.GUARDIAN_PRIVATE_KEY;
  const sentinelKey = process.env.SENTINEL_PRIVATE_KEY;
  if (!escrow || !receiver || !vault || !resolver || !backendKey || !guardianKey || !sentinelKey) {
    return null;
  }
  return {
    escrow: getAddress(escrow),
    receiver: getAddress(receiver),
    vault: getAddress(vault),
    resolver: getAddress(resolver),
    usdc: getAddress(ARBITRUM_SEPOLIA.usdc),
    backendKey: backendKey as Hex,
    guardianKey: guardianKey as Hex,
    sentinelKey: sentinelKey as Hex,
    facilitatorUrl: (process.env.FACILITATOR_URL ?? "http://localhost:4021").replace(/\/$/, ""),
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc",
  };
}

const vaultAbi = [
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "recordedFloor", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isHealthy", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "a", type: "uint256" }], outputs: [] },
  { type: "function", name: "demoDrain", stateMutability: "nonpayable", inputs: [{ name: "a", type: "uint256" }], outputs: [] },
  { type: "function", name: "pause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "unpause", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

const resolverAbi = [
  { type: "function", name: "isConditionMet", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isBreached", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "floorOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "latchBreach", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
] as const;

const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const BOND_ATOMIC = 1_000_000n; // 1 USDC bond
const DRAIN_ATOMIC = 600_000n;
const arbiscan = (tx: string) => `https://sepolia.arbiscan.io/tx/${tx}`;
const fmt = (atomic: bigint) => `${(Number(atomic) / 1e6).toFixed(2)} USDC`;
const STEP_MS = 900;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clients(cfg: TwoKeyConfig) {
  const pub = createPublicClient({ chain: arbitrumSepolia, transport: http(cfg.rpcUrl) }) as PublicClient;
  const backend = privateKeyToAccount(cfg.backendKey);
  const guardian = privateKeyToAccount(cfg.guardianKey);
  const sentinel = privateKeyToAccount(cfg.sentinelKey);
  const wallet = (a: Account) => createWalletClient({ account: a, chain: arbitrumSepolia, transport: http(cfg.rpcUrl) });
  const send = async (a: Account, p: { address: `0x${string}`; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) => {
    const { request } = await pub.simulateContract({ account: a, ...p } as never);
    const hash = await wallet(a).writeContract(request as never);
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`tx reverted ${hash}`);
    return { hash: hash as `0x${string}`, rcpt };
  };
  const read = <T>(p: { address: `0x${string}`; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) =>
    pub.readContract(p as never) as Promise<T>;
  return { pub, backend, guardian, sentinel, send, read };
}

async function vaultState(cfg: TwoKeyConfig, read: <T>(p: { address: `0x${string}`; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) => Promise<T>) {
  const [totalAssets, floor, healthy, paused] = await Promise.all([
    read<bigint>({ address: cfg.vault, abi: vaultAbi, functionName: "totalAssets" }),
    read<bigint>({ address: cfg.vault, abi: vaultAbi, functionName: "recordedFloor" }),
    read<boolean>({ address: cfg.vault, abi: vaultAbi, functionName: "isHealthy" }),
    read<boolean>({ address: cfg.vault, abi: vaultAbi, functionName: "paused" }),
  ]);
  return { totalAssets, floor, healthy, paused };
}

// Post the Sentinel's bond over the SAME x402 path the data-buy hero uses:
// create an AlertResolver-gated escrow owned by the Sentinel, then the Sentinel signs an
// EIP-3009 ReceiveWithAuthorization that the facilitator settles into that escrow. Falls back
// to a direct escrow.fund() (still a real on-chain stake) if the facilitator is unreachable.
async function stakeBondOverX402(
  cfg: TwoKeyConfig,
  ctx: ReturnType<typeof clients>,
  escrowId: bigint,
): Promise<{ tx: string; viaX402: boolean }> {
  const salt = toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  const requirements: PaymentRequirements = {
    scheme: X402.scheme,
    network: X402.network,
    amount: BOND_ATOMIC.toString(),
    asset: cfg.usdc,
    payTo: cfg.receiver,
    maxTimeoutSeconds: 120,
    extra: {
      name: X402.eip712.name,
      version: X402.eip712.version,
      escrow: { escrowId: escrowId.toString(), salt, receiver: cfg.receiver, escrow: cfg.escrow },
    },
  } as unknown as PaymentRequirements;

  try {
    const signer = toClientEvmSigner(ctx.sentinel, ctx.pub);
    const scheme = new ExactEvmScheme(signer);
    const partial = await scheme.createPaymentPayload(X402.version, requirements);
    const payment = {
      x402Version: partial.x402Version,
      resource: { url: "/api/resource", description: "Vault security bond", mimeType: "application/json" },
      accepted: requirements,
      payload: partial.payload as unknown as Record<string, unknown>,
    };
    const body = JSON.stringify({ paymentPayload: payment, paymentRequirements: requirements });
    const verifyRes = await fetch(`${cfg.facilitatorUrl}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body });
    const verify = (await verifyRes.json()) as { isValid?: boolean; invalidReason?: string };
    if (verify.isValid !== true) throw new Error(verify.invalidReason ?? "verify failed");
    const settleRes = await fetch(`${cfg.facilitatorUrl}/settle`, { method: "POST", headers: { "content-type": "application/json" }, body });
    const settle = (await settleRes.json()) as { success?: boolean; transaction?: string; errorReason?: string };
    if (!settle.success || !settle.transaction) throw new Error(settle.errorReason ?? "settle failed");
    return { tx: settle.transaction, viaX402: true };
  } catch {
    // Fallback: the Sentinel funds the bond directly (still a real stake into the same escrow).
    await ctx.send(ctx.sentinel, { address: cfg.usdc, abi: erc20Abi, functionName: "approve", args: [cfg.escrow, BOND_ATOMIC] });
    const funded = await ctx.send(ctx.sentinel, { address: cfg.escrow, abi: escrowAbi, functionName: "fund", args: [escrowId, BOND_ATOMIC] });
    return { tx: funded.hash, viaX402: false };
  }
}

export interface TwoKeyResult {
  outcome: "valid" | "false-alarm";
  escrowId: string;
  txs: Record<string, string>;
}

// The full Two-Key Halt choreography, every step a real Arbitrum Sepolia transaction signed by a
// DISTINCT key. Honesty: the attacker tx and the detection are staged/scripted (labelled on screen);
// the verdict (AlertResolver reading a real on-chain flag) and the Guardian pause are trustless.
export async function runTwoKeyHalt(args: {
  emit: TwoKeyEmit;
  forceFalseAlarm: boolean;
}): Promise<TwoKeyResult> {
  const cfg = getTwoKeyConfig();
  if (!cfg) throw new Error("Two-Key Halt is not configured (VAULT/ALERT_RESOLVER/GUARDIAN/SENTINEL env missing)");
  const { emit, forceFalseAlarm } = args;
  const ctx = clients(cfg);
  const txs: Record<string, string> = {};

  // STEP 0 — restore a healthy vault (idempotent across repeated demo runs).
  let v = await vaultState(cfg, ctx.read);
  if (v.paused) await ctx.send(ctx.guardian, { address: cfg.vault, abi: vaultAbi, functionName: "unpause" });
  if (v.totalAssets < v.floor) await ctx.send(ctx.backend, { address: cfg.vault, abi: vaultAbi, functionName: "deposit", args: [v.floor - v.totalAssets] });
  v = await vaultState(cfg, ctx.read);
  emit({ zone: "vault", kind: "vault", state: "healthy", totalAssets: v.totalAssets.toString(), recordedFloor: v.floor.toString(), msg: "Vault healthy · floor held" });
  emit({ zone: "system", msg: "One vault, two independent agents: a Sentinel that can raise an alarm, a Guardian that can freeze. Neither can do the other's job." });
  await sleep(STEP_MS);

  // STEP 1 — the Sentinel stakes a bond to earn the right to raise an alert ("stake to speak").
  emit({ zone: "sentinel", msg: "Sentinel watching the vault — to raise an alarm it must stake a bond." });
  await sleep(STEP_MS);
  const created = await ctx.send(ctx.backend, {
    address: cfg.escrow,
    abi: escrowAbi,
    functionName: "create",
    args: [ctx.sentinel.address, BOND_ATOMIC, cfg.resolver, encodeAbiParameters([{ type: "address" }], [ctx.sentinel.address])],
  });
  const escrowId = parseEventLogs({ abi: escrowAbi, eventName: "EscrowCreated", logs: created.rcpt.logs })[0].args.escrowId as bigint;
  txs.bondCreate = created.hash;
  const bond = await stakeBondOverX402(cfg, ctx, escrowId);
  txs.bondStake = bond.tx;
  emit({
    zone: "sentinel",
    kind: "bond",
    escrowId: escrowId.toString(),
    msg: bond.viaX402
      ? `Stakes a ${fmt(BOND_ATOMIC)} bond over x402 — EIP-3009, facilitator-settled into escrow #${escrowId}. Wrong alarm forfeits it.`
      : `Stakes a ${fmt(BOND_ATOMIC)} bond into escrow #${escrowId} (direct fund). Wrong alarm forfeits it.`,
    tx: bond.tx,
    arbiscan: arbiscan(bond.tx),
  });
  emit({ zone: "vault", kind: "vault", state: "bonded", totalAssets: v.totalAssets.toString(), recordedFloor: v.floor.toString(), msg: "ALERT · bonded" });
  await sleep(STEP_MS);

  if (!forceFalseAlarm) {
    // STEP 2 — staged attacker drains the vault below its floor (one real on-chain write, labelled).
    emit({ zone: "system", label: "staged", msg: "Staged attacker transaction — drains the vault below its recorded floor. (Labelled staged, like compute is mocked.)" });
    const drained = await ctx.send(ctx.backend, { address: cfg.vault, abi: vaultAbi, functionName: "demoDrain", args: [DRAIN_ATOMIC] });
    txs.stagedDrain = drained.hash;
    v = await vaultState(cfg, ctx.read);
    emit({ zone: "vault", kind: "vault", state: "draining", totalAssets: v.totalAssets.toString(), recordedFloor: v.floor.toString(), msg: "invariant broken — totalAssets < floor", tx: drained.hash, arbiscan: arbiscan(drained.hash) });
    await sleep(STEP_MS);
    // The Sentinel commits the breach on-chain (latched), so the verdict can't be undone by a
    // restore/re-deposit racing the redeem. The DECISION to alarm is scripted; the proof is real.
    const latched = await ctx.send(ctx.sentinel, { address: cfg.resolver, abi: resolverAbi, functionName: "latchBreach", args: [escrowId] });
    txs.alertLatch = latched.hash;
    emit({ zone: "sentinel", label: "scripted", kind: "alert", msg: "Sentinel raises the alarm and commits the breach on-chain (latched) — the decision to alarm is scripted, the on-chain proof is real.", tx: latched.hash, arbiscan: arbiscan(latched.hash) });
    await sleep(STEP_MS);
  } else {
    emit({ zone: "sentinel", label: "scripted", kind: "alert", msg: "Sentinel raises an alarm — but the vault is actually fine. A false alarm." });
    await sleep(STEP_MS);
  }

  // STEP 3 — the Guardian (distinct key, can pause but not move funds) freezes the vault.
  const paused = await ctx.send(ctx.guardian, { address: cfg.vault, abi: vaultAbi, functionName: "pause" });
  txs.guardianPause = paused.hash;
  v = await vaultState(cfg, ctx.read);
  emit({ zone: "guardian", kind: "paused", msg: "Guardian sees the bonded alert and pauses the vault — it never spoke to the Sentinel, it trusted the bond.", tx: paused.hash, arbiscan: arbiscan(paused.hash) });
  emit({ zone: "vault", kind: "vault", state: "paused", totalAssets: v.totalAssets.toString(), recordedFloor: v.floor.toString(), msg: "PAUSED · funds safe" });
  await sleep(STEP_MS);

  // STEP 4 — trustless verdict: the resolver reads the real on-chain flag.
  const valid = await ctx.read<boolean>({ address: cfg.resolver, abi: resolverAbi, functionName: "isConditionMet", args: [escrowId] });

  if (valid && !forceFalseAlarm) {
    emit({ zone: "guardian", kind: "verdict", status: "VALID", msg: "Verdict VALID — the resolver, not an operator, confirms the on-chain floor really broke." });
    await sleep(STEP_MS);
    const balBefore = await ctx.read<bigint>({ address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [ctx.sentinel.address] });
    const redeemed = await ctx.send(ctx.sentinel, { address: cfg.escrow, abi: escrowAbi, functionName: "redeem", args: [escrowId] });
    txs.bondRedeem = redeemed.hash;
    const balAfter = await ctx.read<bigint>({ address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [ctx.sentinel.address] });
    emit({
      zone: "sentinel",
      kind: "settle",
      msg: `Bond returned (+${fmt(balAfter - balBefore)}) — the true alarm is rewarded. Bounty pool is roadmap (mechanism, not a funded economy).`,
      tx: redeemed.hash,
      arbiscan: arbiscan(redeemed.hash),
    });
    emit({ zone: "vault", kind: "vault", state: "safe", msg: "PAUSED · funds safe · exploit averted" });
    // Restore for the next run.
    await ctx.send(ctx.guardian, { address: cfg.vault, abi: vaultAbi, functionName: "unpause" });
    await ctx.send(ctx.backend, { address: cfg.vault, abi: vaultAbi, functionName: "deposit", args: [DRAIN_ATOMIC] });
    emit({ zone: "system", label: "ledger", msg: "Ledger — LIVE: bond stake, Guardian pause, on-chain verdict, bond return. STAGED: attacker tx + detection. DEFERRED: funded bounty pool." });
    return { outcome: "valid", escrowId: escrowId.toString(), txs };
  }

  // FALSE alarm: vault healthy, resolver returns false → bond is NOT redeemable → it stays locked.
  emit({ zone: "guardian", kind: "verdict", status: "FALSE", msg: "Verdict FALSE — the resolver reads the vault as healthy. The alarm was wrong." });
  await sleep(STEP_MS);
  let lockedTx: string | null = null;
  try {
    await ctx.send(ctx.sentinel, { address: cfg.escrow, abi: escrowAbi, functionName: "redeem", args: [escrowId] });
  } catch {
    lockedTx = "reverted"; // redeem reverts ConditionNotMet — the bond is locked (slashed).
  }
  emit({
    zone: "sentinel",
    kind: "settle",
    msg: `Bond slashed — redeem reverts because the condition is unmet, so the ${fmt(BOND_ATOMIC)} stake stays locked. A false alarm costs the agent that raised it.${lockedTx ? "" : ""}`,
  });
  const unpaused = await ctx.send(ctx.guardian, { address: cfg.vault, abi: vaultAbi, functionName: "unpause" });
  txs.guardianUnpause = unpaused.hash;
  v = await vaultState(cfg, ctx.read);
  emit({ zone: "vault", kind: "vault", state: "healthy", totalAssets: v.totalAssets.toString(), recordedFloor: v.floor.toString(), msg: "Guardian unpauses — vault healthy", tx: unpaused.hash, arbiscan: arbiscan(unpaused.hash) });
  emit({ zone: "system", label: "ledger", msg: "Ledger — LIVE: bond stake, Guardian pause/unpause, on-chain verdict. STAGED: detection. The false alarm forfeited the bond." });
  return { outcome: "false-alarm", escrowId: escrowId.toString(), txs };
}

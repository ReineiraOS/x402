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
import { ARBITRUM_SEPOLIA, X402, escrowAbi } from "@reineira-os/x402-shared";
import { ExactEvmScheme, toClientEvmSigner } from "@reineira-os/x402-core/exact/client";
import type { PaymentRequirements } from "@reineira-os/x402-core/types";
import { coverageManagerAbi, insurancePoolAbi } from "./coverage";
import { getReport } from "./incidentReports";
import { runIncidentAgent } from "./incidentAgent";
import { severityTier, type Severity } from "@reineira-os/x402-shared";

export type IncidentEmit = (event: Record<string, unknown>) => void;

export interface IncidentConfig {
  vault: `0x${string}`;
  alertResolver: `0x${string}`;
  escrow: `0x${string}`;
  receiver: `0x${string}`;
  usdc: `0x${string}`;
  coverageManager: `0x${string}`;
  pool: `0x${string}`;
  alertPolicy: `0x${string}`;
  backendKey: Hex;
  guardianKey: Hex;
  sentinelKey: Hex;
  depositorKey: Hex;
  facilitatorUrl: string;
  rpcUrl: string;
}

export function getIncidentConfig(): IncidentConfig | null {
  const e = process.env;
  const required = [
    e.VAULT_ADDRESS,
    e.ALERT_RESOLVER_ADDRESS,
    e.ESCROW_ADDRESS,
    e.X402_RECEIVER_ADDRESS,
    e.COVERAGE_MANAGER_ADDRESS,
    e.COVERAGE_POOL_ADDRESS,
    e.ALERT_POLICY_ADDRESS,
    e.SELLER_PRIVATE_KEY,
    e.GUARDIAN_PRIVATE_KEY,
    e.SENTINEL_PRIVATE_KEY,
    e.DEPOSITOR_PRIVATE_KEY,
  ];
  if (required.some((v) => !v)) return null;
  return {
    vault: getAddress(e.VAULT_ADDRESS!),
    alertResolver: getAddress(e.ALERT_RESOLVER_ADDRESS!),
    escrow: getAddress(e.ESCROW_ADDRESS!),
    receiver: getAddress(e.X402_RECEIVER_ADDRESS!),
    usdc: getAddress(ARBITRUM_SEPOLIA.usdc),
    coverageManager: getAddress(e.COVERAGE_MANAGER_ADDRESS!),
    pool: getAddress(e.COVERAGE_POOL_ADDRESS!),
    alertPolicy: getAddress(e.ALERT_POLICY_ADDRESS!),
    backendKey: e.SELLER_PRIVATE_KEY as Hex,
    guardianKey: e.GUARDIAN_PRIVATE_KEY as Hex,
    sentinelKey: e.SENTINEL_PRIVATE_KEY as Hex,
    depositorKey: e.DEPOSITOR_PRIVATE_KEY as Hex,
    facilitatorUrl: (e.FACILITATOR_URL ?? "http://localhost:4021").replace(/\/$/, ""),
    rpcUrl: e.ARBITRUM_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc",
  };
}

export const vaultAbi = [
  {
    type: "function",
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "recordedFloor",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "demoDrain",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }],
    outputs: [],
  },
  { type: "function", name: "pause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "unpause", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

export const alertResolverAbi = [
  {
    type: "function",
    name: "isConditionMet",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "isBreached",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "latchBreach",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }],
    outputs: [],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const DRAIN_ATOMIC = 100_000n;
export const arbiscan = (tx: string) => `https://sepolia.arbiscan.io/tx/${tx}`;
export const fmt = (atomic: bigint) => `${(Number(atomic) / 1e6).toFixed(2)} USDC`;
export const STEP_MS = 900;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function clients(cfg: IncidentConfig) {
  const pub = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(cfg.rpcUrl),
  }) as PublicClient;
  const backend = privateKeyToAccount(cfg.backendKey);
  const guardian = privateKeyToAccount(cfg.guardianKey);
  const sentinel = privateKeyToAccount(cfg.sentinelKey);
  const depositor = privateKeyToAccount(cfg.depositorKey);
  const wallet = (a: Account) =>
    createWalletClient({ account: a, chain: arbitrumSepolia, transport: http(cfg.rpcUrl) });
  const send = async (
    a: Account,
    p: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
    },
  ) => {
    const { request } = await pub.simulateContract({ account: a, ...p } as never);
    const hash = await wallet(a).writeContract(request as never);
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`tx reverted ${hash}`);
    return { hash: hash as `0x${string}`, rcpt };
  };
  const read = <T>(p: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }) => pub.readContract(p as never) as Promise<T>;
  return { pub, backend, guardian, sentinel, depositor, send, read };
}

export async function createGatedEscrow(
  cfg: IncidentConfig,
  ctx: ReturnType<typeof clients>,
  beneficiary: `0x${string}`,
  amount: bigint,
): Promise<{ escrowId: bigint; tx: string }> {
  const created = await ctx.send(ctx.backend, {
    address: cfg.escrow,
    abi: escrowAbi,
    functionName: "create",
    args: [
      beneficiary,
      amount,
      cfg.alertResolver,
      encodeAbiParameters([{ type: "address" }], [beneficiary]),
    ],
  });
  const escrowId = parseEventLogs({
    abi: escrowAbi,
    eventName: "EscrowCreated",
    logs: created.rcpt.logs,
  })[0].args.escrowId as bigint;
  return { escrowId, tx: created.hash };
}

// Stake the sentinel's bond over x402 (EIP-3009), falling back to a direct escrow.fund().
export async function stakeBond(
  cfg: IncidentConfig,
  ctx: ReturnType<typeof clients>,
  escrowId: bigint,
  bondAtomic: bigint,
): Promise<{ tx: string; viaX402: boolean }> {
  const salt = toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  const requirements = {
    scheme: X402.scheme,
    network: X402.network,
    amount: bondAtomic.toString(),
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
      resource: {
        url: "/api/resource",
        description: "Incident response bond",
        mimeType: "application/json",
      },
      accepted: requirements,
      payload: partial.payload as unknown as Record<string, unknown>,
    };
    const body = JSON.stringify({ paymentPayload: payment, paymentRequirements: requirements });
    const verifyRes = await fetch(`${cfg.facilitatorUrl}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const verify = (await verifyRes.json()) as { isValid?: boolean; invalidReason?: string };
    if (verify.isValid !== true) throw new Error(verify.invalidReason ?? "verify failed");
    const settleRes = await fetch(`${cfg.facilitatorUrl}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const settle = (await settleRes.json()) as {
      success?: boolean;
      transaction?: string;
      errorReason?: string;
    };
    if (!settle.success || !settle.transaction)
      throw new Error(settle.errorReason ?? "settle failed");
    return { tx: settle.transaction, viaX402: true };
  } catch {
    await ctx.send(ctx.sentinel, {
      address: cfg.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [cfg.escrow, bondAtomic],
    });
    const funded = await ctx.send(ctx.sentinel, {
      address: cfg.escrow,
      abi: escrowAbi,
      functionName: "fund",
      args: [escrowId, bondAtomic],
    });
    return { tx: funded.hash, viaX402: false };
  }
}

// Is the new alert policy allow-listed on the pool? Gates the live payout (graceful degrade).
export async function coverageReady(
  cfg: IncidentConfig,
  ctx: ReturnType<typeof clients>,
): Promise<boolean> {
  try {
    return await ctx.read<boolean>({
      address: cfg.pool,
      abi: insurancePoolAbi,
      functionName: "isPolicy",
      args: [cfg.alertPolicy],
    });
  } catch {
    return false;
  }
}

export { coverageManagerAbi };

async function purchaseVaultCoverage(
  cfg: IncidentConfig,
  ctx: ReturnType<typeof clients>,
  escrowId: bigint,
  amountAtomic: bigint,
): Promise<{ coverageId: bigint | null; tx: string | null; note: string | null }> {
  const block = await ctx.pub.getBlock({ blockTag: "latest" });
  const expiry = BigInt(Number(block.timestamp) + 600);
  const policyData = encodeAbiParameters([{ type: "uint256" }], [escrowId]);
  try {
    const { result, request } = await ctx.pub.simulateContract({
      account: ctx.backend,
      address: cfg.coverageManager,
      abi: coverageManagerAbi,
      functionName: "purchaseCoverage",
      args: [
        ctx.depositor.address,
        cfg.pool,
        cfg.alertPolicy,
        escrowId,
        amountAtomic,
        expiry,
        policyData,
        "0x",
      ],
    });
    const hash = await createWalletClient({
      account: ctx.backend,
      chain: arbitrumSepolia,
      transport: http(cfg.rpcUrl),
    }).writeContract(request);
    const rcpt = await ctx.pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success")
      return { coverageId: null, tx: hash, note: "coverage purchase reverted" };
    return { coverageId: result as bigint, tx: hash, note: null };
  } catch (error) {
    return {
      coverageId: null,
      tx: null,
      note: error instanceof Error ? error.message.split("\n")[0] : String(error),
    };
  }
}

export interface IncidentResult {
  outcome: "TP" | "FN" | "FP" | "TN";
  reportId: string;
  severity: Severity;
  decision: "halt" | "monitor";
}

export async function runIncidentResponse(args: {
  emit: IncidentEmit;
  reportId?: string | null;
  apiKey: string | undefined;
}): Promise<IncidentResult> {
  const cfg = getIncidentConfig();
  if (!cfg)
    throw new Error(
      "Incident Response is not configured (VAULT/ALERT_RESOLVER/ALERT_POLICY/COVERAGE/DEPOSITOR env missing)",
    );
  const { emit } = args;
  const ctx = clients(cfg);
  const report = getReport(args.reportId);

  // STEP 0 — restore a healthy, unpaused vault; keep sentinel solvent for the bond.
  const paused = await ctx.read<boolean>({
    address: cfg.vault,
    abi: vaultAbi,
    functionName: "paused",
  });
  if (paused)
    await ctx.send(ctx.guardian, { address: cfg.vault, abi: vaultAbi, functionName: "unpause" });
  const total = await ctx.read<bigint>({
    address: cfg.vault,
    abi: vaultAbi,
    functionName: "totalAssets",
  });
  const floor = await ctx.read<bigint>({
    address: cfg.vault,
    abi: vaultAbi,
    functionName: "recordedFloor",
  });
  if (total < floor)
    await ctx.send(ctx.backend, {
      address: cfg.vault,
      abi: vaultAbi,
      functionName: "deposit",
      args: [floor - total],
    });
  const maxBond = severityTier("critical").bondAtomic;
  const sentinelUsdc = await ctx.read<bigint>({
    address: cfg.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [ctx.sentinel.address],
  });
  if (sentinelUsdc < maxBond)
    await ctx.send(ctx.backend, {
      address: cfg.usdc,
      abi: erc20Abi,
      functionName: "transfer",
      args: [ctx.sentinel.address, maxBond * 3n - sentinelUsdc],
    });
  emit({
    zone: "vault",
    kind: "vault",
    state: "healthy",
    msg: "Vault healthy · monitored by the Incident Desk",
  });
  await sleep(STEP_MS);

  // STEP 1 — the report arrives.
  emit({
    zone: "incident",
    kind: "report",
    source: report.source,
    title: report.title,
    body: report.body,
    claimedSeverity: report.severity,
    msg: `${report.source}: ${report.title}`,
  });
  await sleep(STEP_MS);

  // STEP 2 — the depositor is insured against a vault breach (sized to the report's true severity).
  const payoutAtomic = severityTier(report.severity).payoutAtomic;
  const ready = await coverageReady(cfg, ctx);
  let coverageId: bigint | null = null;
  const covEscrow = await createGatedEscrow(cfg, ctx, ctx.depositor.address, payoutAtomic);
  if (ready) {
    const cov = await purchaseVaultCoverage(cfg, ctx, covEscrow.escrowId, payoutAtomic);
    coverageId = cov.coverageId;
    emit({
      zone: "incident",
      kind: "coverage",
      msg:
        cov.coverageId !== null
          ? `Depositor insured for ${fmt(payoutAtomic)} (coverage #${cov.coverageId}).`
          : `Coverage attach failed: ${cov.note}`,
      tx: cov.tx ?? undefined,
      arbiscan: cov.tx ? arbiscan(cov.tx) : undefined,
    });
  } else {
    emit({
      zone: "incident",
      kind: "coverage",
      msg: `Coverage pending one-time pool setup — depositor would be insured for ${fmt(payoutAtomic)}.`,
      label: "scripted",
    });
  }
  await sleep(STEP_MS);

  // STEP 3 — the agent triages and decides.
  const verdict = await runIncidentAgent({ report, emit, apiKey: args.apiKey });
  const bondAtomic = severityTier(verdict.severity).bondAtomic;
  emit({
    zone: "incident",
    kind: "verdict",
    severity: verdict.severity,
    decision: verdict.decision,
    msg: `Verdict: ${verdict.severity.toUpperCase()} · ${verdict.decision.toUpperCase()} — ${verdict.rationale}`,
  });
  await sleep(STEP_MS);

  // STEP 4 — branch.
  if (verdict.decision === "halt") {
    const bondEscrow = await createGatedEscrow(cfg, ctx, ctx.sentinel.address, bondAtomic);
    const bond = await stakeBond(cfg, ctx, bondEscrow.escrowId, bondAtomic);
    emit({
      zone: "incident",
      kind: "bond",
      msg: `Agent stakes a ${fmt(bondAtomic)} bond on its ${verdict.severity} halt call (escrow #${bondEscrow.escrowId}). A wrong freeze forfeits it.`,
      tx: bond.tx,
      arbiscan: arbiscan(bond.tx),
    });
    await sleep(STEP_MS);

    if (report.realVuln) {
      // TP — a real exploit gets a first grab; the freeze stops the rest; the alarm is justified.
      const drained = await ctx.send(ctx.backend, {
        address: cfg.vault,
        abi: vaultAbi,
        functionName: "demoDrain",
        args: [DRAIN_ATOMIC],
      });
      await ctx.send(ctx.sentinel, {
        address: cfg.alertResolver,
        abi: alertResolverAbi,
        functionName: "latchBreach",
        args: [bondEscrow.escrowId],
      });
      emit({
        zone: "incident",
        kind: "breach",
        label: "staged",
        msg: "Staged exploit lands a first grab below the floor — the breach is real.",
        tx: drained.hash,
        arbiscan: arbiscan(drained.hash),
      });
      const pausedTx = await ctx.send(ctx.guardian, {
        address: cfg.vault,
        abi: vaultAbi,
        functionName: "pause",
      });
      emit({
        zone: "incident",
        kind: "halt",
        msg: "Guardian freezes the vault — the rest of the funds are safe.",
        tx: pausedTx.hash,
        arbiscan: arbiscan(pausedTx.hash),
      });
      await sleep(STEP_MS);
      const redeemed = await ctx.send(ctx.sentinel, {
        address: cfg.escrow,
        abi: escrowAbi,
        functionName: "redeem",
        args: [bondEscrow.escrowId],
      });
      emit({
        zone: "incident",
        kind: "settle",
        msg: `Verdict VALID — bond returned. The correct freeze is rewarded.`,
        tx: redeemed.hash,
        arbiscan: arbiscan(redeemed.hash),
      });
      await ctx.send(ctx.guardian, { address: cfg.vault, abi: vaultAbi, functionName: "unpause" });
      await ctx.send(ctx.backend, {
        address: cfg.vault,
        abi: vaultAbi,
        functionName: "deposit",
        args: [DRAIN_ATOMIC],
      });
      emit({
        zone: "system",
        label: "ledger",
        msg: "LIVE: bond stake, on-chain breach, Guardian freeze, bond return. STAGED: the exploit tx.",
      });
      return {
        outcome: "TP",
        reportId: report.id,
        severity: verdict.severity,
        decision: verdict.decision,
      };
    }

    // FP — the report was bogus; the vault is provably healthy; the bond is slashed.
    const pausedTx = await ctx.send(ctx.guardian, {
      address: cfg.vault,
      abi: vaultAbi,
      functionName: "pause",
    });
    emit({
      zone: "incident",
      kind: "halt",
      msg: "Guardian freezes the vault on the agent's call.",
      tx: pausedTx.hash,
      arbiscan: arbiscan(pausedTx.hash),
    });
    await sleep(STEP_MS);
    try {
      await ctx.send(ctx.sentinel, {
        address: cfg.escrow,
        abi: escrowAbi,
        functionName: "redeem",
        args: [bondEscrow.escrowId],
      });
    } catch {
      // redeem reverts ConditionNotMet — the bond is locked (slashed)
    }
    emit({
      zone: "incident",
      kind: "slash",
      msg: `Verdict FALSE — the resolver reads the vault as healthy. The ${fmt(bondAtomic)} bond is slashed. A false alarm costs the agent by criticality.`,
    });
    const unpaused = await ctx.send(ctx.guardian, {
      address: cfg.vault,
      abi: vaultAbi,
      functionName: "unpause",
    });
    emit({
      zone: "vault",
      kind: "vault",
      state: "healthy",
      msg: "Guardian unpauses — vault healthy.",
      tx: unpaused.hash,
      arbiscan: arbiscan(unpaused.hash),
    });
    emit({
      zone: "system",
      label: "ledger",
      msg: "LIVE: bond stake, Guardian pause/unpause, on-chain verdict. The false alarm forfeited the bond.",
    });
    return {
      outcome: "FP",
      reportId: report.id,
      severity: verdict.severity,
      decision: verdict.decision,
    };
  }

  // decision === "monitor"
  if (report.realVuln) {
    // FN (HAPPY) — the agent missed it; the vault drains; the insured pool makes the depositor whole.
    const drained = await ctx.send(ctx.backend, {
      address: cfg.vault,
      abi: vaultAbi,
      functionName: "demoDrain",
      args: [DRAIN_ATOMIC],
    });
    await ctx.send(ctx.sentinel, {
      address: cfg.alertResolver,
      abi: alertResolverAbi,
      functionName: "latchBreach",
      args: [covEscrow.escrowId],
    });
    emit({
      zone: "incident",
      kind: "breach",
      label: "staged",
      msg: "Agent chose to monitor — the exploit drains the vault below its floor.",
      tx: drained.hash,
      arbiscan: arbiscan(drained.hash),
    });
    await sleep(STEP_MS);

    if (ready && coverageId !== null) {
      const balBefore = await ctx.read<bigint>({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [ctx.depositor.address],
      });
      const disputeTx = await ctx.send(ctx.depositor, {
        address: cfg.coverageManager,
        abi: coverageManagerAbi,
        functionName: "dispute",
        args: [coverageId, "0x"],
      });
      const balAfter = await ctx.read<bigint>({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [ctx.depositor.address],
      });
      const delta = balAfter > balBefore ? balAfter - balBefore : 0n;
      emit({
        zone: "incident",
        kind: "payout",
        msg: `Insurance pool pays the depositor ${fmt(delta)} — compensation by severity.`,
        tx: disputeTx.hash,
        arbiscan: arbiscan(disputeTx.hash),
      });
    } else {
      emit({
        zone: "incident",
        kind: "payout",
        label: "scripted",
        msg: `Coverage pending one-time setup — the pool would pay the depositor ${fmt(payoutAtomic)}.`,
      });
    }
    await ctx.send(ctx.backend, {
      address: cfg.vault,
      abi: vaultAbi,
      functionName: "deposit",
      args: [DRAIN_ATOMIC],
    });
    emit({
      zone: "system",
      label: "ledger",
      msg: "LIVE: coverage attach, on-chain breach, pool payout. STAGED: the exploit tx + detection.",
    });
    return {
      outcome: "FN",
      reportId: report.id,
      severity: verdict.severity,
      decision: verdict.decision,
    };
  }

  // TN — no real vuln, no action.
  emit({
    zone: "incident",
    kind: "settle",
    msg: "No credible exploit — the agent holds. No freeze, no claim.",
  });
  return {
    outcome: "TN",
    reportId: report.id,
    severity: verdict.severity,
    decision: verdict.decision,
  };
}

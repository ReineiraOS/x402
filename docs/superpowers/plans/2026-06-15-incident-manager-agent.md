# Incident-Manager Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Incident Response" demo scenario where a Claude-driven Incident-Manager Agent reads a vulnerability report, classifies severity, and decides to halt or monitor a `ProtectedVault` — with real on-chain consequences: a missed real vuln pays the depositor from the insurance pool (happy), a false alarm slashes the agent's bond (unhappy).

**Architecture:** Compose existing, deployed primitives. Reuse `ProtectedVault` + `AlertResolver` + Guardian pause + x402 bond (from `lib/twoKey.ts`) for the halt branch, and `CoverageManager`/`CoveragePool` + a new `DeliveryPolicy` instance bound to `AlertResolver` for the payout branch (reusing the proven `CoverageManager.dispute()` path from `app/api/coverage/claim/route.ts`). Add only off-chain pieces (severity model, preset reports, the LLM agent, an orchestrator) plus one new on-chain deployment (no new Solidity logic) and a new UI scenario page. Scenarios are mode-based: the client streams `GET /api/run?mode=incident` as SSE.

**Tech Stack:** TypeScript, Next.js 16 (App Router, SSE via `ReadableStream`), viem, `@anthropic-ai/sdk` (claude-haiku-4-5), Foundry (Solidity `^0.8.25`), pnpm workspaces, vitest (shared package).

---

## Prerequisites & operational setup

These are environment/operational facts the implementer must know. They are NOT code tasks but gate the on-chain payout branch.

- **`packages/contracts` is Foundry**, not Hardhat. Build: `pnpm --filter @reineira-os/x402-rss-contracts run compile` (`forge build`). Test: `... run test` (`forge test -vv`).
- **New env vars** to add to `apps/demo/.env.local` (and document in `DEPLOY.md`):
  - `ALERT_POLICY_ADDRESS` — the new `DeliveryPolicy` instance bound to `AlertResolver` (deployed in Task 1).
  - `DEPOSITOR_PRIVATE_KEY` — the coverage holder ("victim"). Must hold a little Arbitrum Sepolia ETH for the `dispute` gas; receives the USDC payout. Distinct from Guardian/Sentinel/backend for narrative clarity.
- Reused env (already present): `VAULT_ADDRESS`, `ALERT_RESOLVER_ADDRESS`, `ESCROW_ADDRESS`, `X402_RECEIVER_ADDRESS`, `GUARDIAN_PRIVATE_KEY`, `SENTINEL_PRIVATE_KEY`, `SELLER_PRIVATE_KEY` (backend), `COVERAGE_MANAGER_ADDRESS`, `COVERAGE_POOL_ADDRESS`, `FACILITATOR_URL`, `ARBITRUM_SEPOLIA_RPC_URL`, `ANTHROPIC_API_KEY`.
- **Pool allow-list (owner-only):** the new `ALERT_POLICY_ADDRESS` must be registered on the deployed pool/coverage-manager before real payouts work — the same gate `coverageReadiness()` checks via `pool.isPolicy(policy)`. The pool/CoverageManager source lives outside this repo; whoever deployed it runs the registration (the same `addPolicy`/`registerPolicy` + `setInsuranceManager` calls used for the delivery policy). **The orchestrator MUST degrade gracefully** (emit a "coverage pending one-time setup" note and skip the on-chain payout) when `isPolicy(alertPolicy)` is false, exactly like `attachCoverage()` does today. This keeps the demo runnable before the owner step lands.

## File structure (created / modified)

Created:
- `packages/contracts/script/AlertPolicyDeploy.s.sol` — forge script: deploy `DeliveryPolicy(coverageManager, alertResolver)`.
- `packages/contracts/test/AlertPolicy.t.sol` — forge test: `judge` follows `AlertResolver.isBreached`.
- `packages/shared/src/severity.ts` — `Severity` type + tier→amount table.
- `packages/shared/test/severity.test.ts` — vitest unit tests for the severity helpers.
- `apps/demo/lib/incidentReports.ts` — preset report fixtures.
- `apps/demo/lib/incidentAgent.ts` — Claude classifier agent.
- `apps/demo/lib/incident.ts` — `runIncidentResponse()` orchestrator.
- `apps/demo/app/incident-response/page.tsx` — scenario page.
- `apps/demo/app/components/IncidentResponseTheater.tsx` — scenario UI.
- `apps/demo/app/components/IncidentResponseTheater.module.css` — scenario styles.

Modified:
- `packages/shared/src/index.ts` — re-export `./severity.js`.
- `apps/demo/app/api/run/route.ts` — add `mode === "incident"` branch.
- `apps/demo/app/components/Sidebar.tsx` — add the `SHOWCASES` nav entry.
- `apps/demo/.env.local` / `DEPLOY.md` — new env vars.

---

## Task 1: Deploy + test the AlertResolver-bound coverage policy (Foundry)

**Files:**
- Create: `packages/contracts/script/AlertPolicyDeploy.s.sol`
- Create: `packages/contracts/test/AlertPolicy.t.sol`

Context: `DeliveryPolicy` constructor is `(address coverageManager_, address resolver_)`; `judge(coverageId, bytes)` returns `IBreachOracle(resolver).isBreached(binding.escrowId)` (`contracts/DeliveryPolicy.sol:31,56`). `AlertResolver(escrow_, vault_)` exposes `isBreached(uint256)` and `onConditionSet(uint256, bytes)` (`contracts/AlertResolver.sol`). `ProtectedVault(admin, guardian, demo)` with `deposit`, `demoDrain` (`contracts/ProtectedVault.sol`). A mock escrow is needed so `AlertResolver.onConditionSet` can be invoked as the escrow.

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/test/AlertPolicy.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {ProtectedVault} from "../contracts/ProtectedVault.sol";
import {AlertResolver} from "../contracts/AlertResolver.sol";
import {DeliveryPolicy} from "../contracts/DeliveryPolicy.sol";

contract AlertPolicyTest is Test {
    ProtectedVault internal vault;
    AlertResolver internal resolver;
    DeliveryPolicy internal policy;

    address internal escrow = address(0xE5C); // stands in for the escrow caller
    address internal coverageManager = address(0xC0FFEE);
    address internal guardian = address(0x647D1A);
    uint256 internal constant ESCROW_ID = 1;
    uint256 internal constant COVERAGE_ID = 7;

    function setUp() public {
        vault = new ProtectedVault(address(this), guardian, address(this));
        vault.deposit(1000);
        resolver = new AlertResolver(escrow, address(vault));
        policy = new DeliveryPolicy(coverageManager, address(resolver));

        // Configure the resolver for ESCROW_ID (escrow snapshots the floor).
        vm.prank(escrow);
        resolver.onConditionSet(ESCROW_ID, abi.encode(address(this)));

        // Bind the coverage to ESCROW_ID (coverageManager calls onPolicySet).
        vm.prank(coverageManager);
        policy.onPolicySet(COVERAGE_ID, abi.encode(ESCROW_ID));
    }

    function test_judgeFalseWhenHealthy() public view {
        assertFalse(resolver.isBreached(ESCROW_ID));
        assertFalse(policy.judge(COVERAGE_ID, ""));
    }

    function test_judgeTrueAfterDrain() public {
        vault.demoDrain(400); // totalAssets 600 < floor 1000
        assertTrue(resolver.isBreached(ESCROW_ID));
        assertTrue(policy.judge(COVERAGE_ID, ""));
    }
}
```

- [ ] **Step 2: Run the test to verify it passes (no new contract code needed)**

Run: `pnpm --filter @reineira-os/x402-rss-contracts run test`
Expected: `AlertPolicyTest` — both tests PASS. (This is a reuse test: it proves `DeliveryPolicy` tracks `AlertResolver` with zero new Solidity. If a compile error about constructor arity appears, re-check signatures against `DeliveryPolicy.sol:31` / `AlertResolver.sol`.)

- [ ] **Step 3: Write the deploy script**

Create `packages/contracts/script/AlertPolicyDeploy.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";
import {DeliveryPolicy} from "../contracts/DeliveryPolicy.sol";

contract AlertPolicyDeploy is Script {
    function run() external {
        address coverageManager = vm.envAddress("COVERAGE_MANAGER_ADDRESS");
        address alertResolver = vm.envAddress("ALERT_RESOLVER_ADDRESS");
        vm.startBroadcast();
        DeliveryPolicy policy = new DeliveryPolicy(coverageManager, alertResolver);
        vm.stopBroadcast();
        console.log("ALERT_POLICY_ADDRESS=%s", address(policy));
    }
}
```

- [ ] **Step 4: Verify the script compiles**

Run: `pnpm --filter @reineira-os/x402-rss-contracts run compile`
Expected: `forge build` succeeds, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/test/AlertPolicy.t.sol packages/contracts/script/AlertPolicyDeploy.s.sol
git commit -m "feat(contracts): AlertResolver-bound coverage policy deploy + test"
```

- [ ] **Step 6: Deploy to Arbitrum Sepolia and record the address (operational)**

Run (from `packages/contracts`, with the deployer key that owns the pool):
```bash
COVERAGE_MANAGER_ADDRESS=0x3fcD1896745B2b91b4397e7E762910Fbf7eE9D22 \
ALERT_RESOLVER_ADDRESS=0xA3CE8c5d9c81A86f0216eC55b9992dCdcB9E5263 \
forge script script/AlertPolicyDeploy.s.sol --broadcast --chain-id 421614 \
  --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"
```
Expected: console prints `ALERT_POLICY_ADDRESS=0x…`. Copy it into `apps/demo/.env.local` as `ALERT_POLICY_ADDRESS`. Then (pool owner) register it: `pool.addPolicy(ALERT_POLICY_ADDRESS)` (+ `registerPolicy` if your pool revision uses a separate registry), mirroring how the delivery policy was allow-listed. Verify with a `cast call <pool> "isPolicy(address)(bool)" <ALERT_POLICY_ADDRESS>` → `true`.

> If you cannot register the policy (not the pool owner), the demo still runs — the FN branch will report "coverage pending one-time setup" instead of a live payout (Task 6 handles this).

---

## Task 2: Severity model in the shared package

**Files:**
- Create: `packages/shared/src/severity.ts`
- Create: `packages/shared/test/severity.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/severity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SEVERITY_TIERS, SEVERITY_ORDER, isSeverity, severityTier } from "../src/severity.js";

describe("severity", () => {
  it("scales bond and payout monotonically across tiers", () => {
    let prevBond = -1n;
    let prevPayout = -1n;
    for (const s of SEVERITY_ORDER) {
      const tier = severityTier(s);
      expect(tier.bondAtomic).toBeGreaterThan(prevBond);
      expect(tier.payoutAtomic).toBeGreaterThan(prevPayout);
      prevBond = tier.bondAtomic;
      prevPayout = tier.payoutAtomic;
    }
  });

  it("payout is always >= bond for a tier", () => {
    for (const s of SEVERITY_ORDER) {
      const t = SEVERITY_TIERS[s];
      expect(t.payoutAtomic).toBeGreaterThanOrEqual(t.bondAtomic);
    }
  });

  it("isSeverity guards unknown values", () => {
    expect(isSeverity("critical")).toBe(true);
    expect(isSeverity("nope")).toBe(false);
    expect(isSeverity(3)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @reineira-os/x402-rss-shared test`
Expected: FAIL — cannot resolve `../src/severity.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/severity.ts`:

```typescript
export type Severity = "low" | "medium" | "high" | "critical";

export interface SeverityTier {
  /** Bond the agent stakes when it raises an alarm; forfeited in full on a false positive. */
  bondAtomic: bigint;
  /** Coverage payout the pool pays the depositor on a real breach the agent missed. */
  payoutAtomic: bigint;
}

export const SEVERITY_ORDER: readonly Severity[] = ["low", "medium", "high", "critical"];

export const SEVERITY_TIERS: Record<Severity, SeverityTier> = {
  low: { bondAtomic: 50_000n, payoutAtomic: 100_000n },
  medium: { bondAtomic: 100_000n, payoutAtomic: 250_000n },
  high: { bondAtomic: 250_000n, payoutAtomic: 500_000n },
  critical: { bondAtomic: 500_000n, payoutAtomic: 1_000_000n },
};

export function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && (SEVERITY_ORDER as readonly string[]).includes(value);
}

export function severityTier(severity: Severity): SeverityTier {
  return SEVERITY_TIERS[severity];
}
```

- [ ] **Step 4: Re-export from the package index**

Modify `packages/shared/src/index.ts` — add the line after the existing exports:

```typescript
export * from "./severity.js";
```

- [ ] **Step 5: Run the test to verify it passes + build the package**

Run: `pnpm --filter @reineira-os/x402-rss-shared test && pnpm --filter @reineira-os/x402-rss-shared run build`
Expected: tests PASS; `dist/` rebuilt (so the demo's `@reineira-os/x402-rss-shared` import resolves the new export).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/severity.ts packages/shared/src/index.ts packages/shared/test/severity.test.ts
git commit -m "feat(shared): incident severity tiers (bond + payout scale)"
```

---

## Task 3: Preset incident reports

**Files:**
- Create: `apps/demo/lib/incidentReports.ts`

Context: mirrors the fixture style of `apps/demo/lib/resources.ts` (a `CATALOG` array + a `getX(id)` lookup). The agent's branch is DERIVED from `decision × realVuln`; `expectedBranch` is only a QA/label hint.

- [ ] **Step 1: Write the implementation**

Create `apps/demo/lib/incidentReports.ts`:

```typescript
import type { Severity } from "@reineira-os/x402-rss-shared";

export interface IncidentReport {
  id: string;
  source: "Immunefi" | "HackenProof" | "anon rumor";
  title: string;
  body: string;
  affectedContract: string;
  /** Ground truth: is there actually an exploitable vulnerability? */
  realVuln: boolean;
  /** True severity if realVuln; the severity the report *claims* otherwise. */
  severity: Severity;
  /** QA hint only — the live branch is computed from the agent's decision. */
  expectedBranch: "TP" | "FN" | "FP";
}

export const INCIDENT_REPORTS: IncidentReport[] = [
  {
    id: "immunefi-reentrancy",
    source: "Immunefi",
    title: "Critical: reentrancy in ProtectedVault withdrawal path",
    body:
      "Triaged Immunefi submission with a working PoC: an attacker re-enters the vault during " +
      "withdrawal and drains balances below the recorded floor. Funds at immediate risk.",
    affectedContract: "ProtectedVault",
    realVuln: true,
    severity: "critical",
    expectedBranch: "TP",
  },
  {
    id: "hackenproof-rounding",
    source: "HackenProof",
    title: "Medium: rounding drift in floor accounting",
    body:
      "Reporter claims a rounding discrepancy lets the recorded floor drift by a few wei per " +
      "deposit. No PoC of fund loss attached; impact looks cosmetic.",
    affectedContract: "ProtectedVault",
    realVuln: true,
    severity: "medium",
    expectedBranch: "FN",
  },
  {
    id: "anon-rumor",
    source: "anon rumor",
    title: "Unverified: 'vault is exploitable, freeze now!'",
    body:
      "Anonymous DM with no contract address, no PoC, no transaction trace — just urgency. " +
      "Pattern matches prior copy-paste scare campaigns against unrelated protocols.",
    affectedContract: "ProtectedVault",
    realVuln: false,
    severity: "critical",
    expectedBranch: "FP",
  },
];

const DEFAULT_REPORT_ID = "immunefi-reentrancy";

export function getReport(id?: string | null): IncidentReport {
  return INCIDENT_REPORTS.find((r) => r.id === id) ?? INCIDENT_REPORTS[0]!;
}

export { DEFAULT_REPORT_ID };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @reineira-os/x402-rss-demo run typecheck`
Expected: PASS (the `Severity` import resolves from the rebuilt shared package).

- [ ] **Step 3: Commit**

```bash
git add apps/demo/lib/incidentReports.ts
git commit -m "feat(demo): preset incident-report fixtures"
```

---

## Task 4: Incident-Manager classifier agent

**Files:**
- Create: `apps/demo/lib/incidentAgent.ts`

Context: mirrors `apps/demo/lib/sellerAgent.ts` exactly — same `Anthropic` streaming pattern, same `emit` shape, same model. Streams reasoning to `zone: "incident", kind: "thinking"`. Returns a clamped classification.

- [ ] **Step 1: Write the implementation**

Create `apps/demo/lib/incidentAgent.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { isSeverity, type Severity } from "@reineira-os/x402-rss-shared";
import type { IncidentReport } from "./incidentReports";

type RunEvent = Record<string, unknown>;
type Emit = (event: RunEvent) => void;

const MODEL = "claude-haiku-4-5-20251001";

const CLASSIFY_TOOL: Tool = {
  name: "classify_incident",
  description:
    "Record your triage of the vulnerability report: its severity, and whether to HALT the " +
    "monitored contract now or keep MONITORING. Call this once you have decided.",
  input_schema: {
    type: "object",
    properties: {
      severity: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
        description: "Your assessed severity of the reported issue.",
      },
      decision: {
        type: "string",
        enum: ["halt", "monitor"],
        description:
          "halt = freeze the contract now (you stake a bond on this call being right); " +
          "monitor = take no freezing action.",
      },
      rationale: {
        type: "string",
        description: "One crisp sentence justifying the call, in your own voice.",
      },
    },
    required: ["severity", "decision", "rationale"],
  },
};

const PERSONA =
  "You are the Reineira Incident Desk — an autonomous incident-manager agent guarding on-chain " +
  "contracts. You weigh credibility (source, PoC, specificity) against blast radius. A wrong " +
  "freeze forfeits your staked bond; missing a real exploit lets funds drain. You are decisive but " +
  "skeptical of unsourced panic.";

function buildPrompt(report: IncidentReport): string {
  return (
    `${PERSONA}\n\n` +
    `A vulnerability report just arrived.\n` +
    `Source: ${report.source}\n` +
    `Affected contract: ${report.affectedContract}\n` +
    `Title: ${report.title}\n` +
    `Body: ${report.body}\n\n` +
    `Think out loud very briefly (one or two sentences), then call classify_incident. Keep it terse; ` +
    `this is a live demo.`
  );
}

export interface IncidentDecision {
  severity: Severity;
  decision: "halt" | "monitor";
  rationale: string;
}

// Reads a report and returns a clamped classification. Streams reasoning to the "incident" zone.
// Falls back to a deterministic call (so the on-chain flow stays demoable without an API key).
export async function runIncidentAgent(args: {
  report: IncidentReport;
  emit: Emit;
  apiKey: string | undefined;
}): Promise<IncidentDecision> {
  const { report, emit, apiKey } = args;

  const fallback = (): IncidentDecision => ({
    severity: report.severity,
    decision: report.severity === "high" || report.severity === "critical" ? "halt" : "monitor",
    rationale: "No model key — deterministic triage from the report's claimed severity.",
  });

  if (!apiKey) {
    const d = fallback();
    emit({ zone: "incident", kind: "thinking", msg: d.rationale });
    return d;
  }

  const anthropic = new Anthropic({ apiKey });
  const messages: MessageParam[] = [
    { role: "user", content: "A new vulnerability report just landed. Triage it and act." },
  ];

  const modelStream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 400,
    system: buildPrompt(report),
    tools: [CLASSIFY_TOOL],
    messages,
  });

  let textBuffer = "";
  modelStream.on("text", (delta) => {
    textBuffer += delta;
    emit({ zone: "incident", kind: "thinking", msg: delta, stream: true, final: false });
  });

  const finalMessage = await modelStream.finalMessage();
  if (textBuffer.length > 0) emit({ zone: "incident", kind: "thinking", streamEnd: true });

  const toolUse = finalMessage.content.find(
    (block): block is ToolUseBlock => block.type === "tool_use" && block.name === "classify_incident",
  );
  if (!toolUse) {
    const d = fallback();
    emit({ zone: "incident", kind: "thinking", msg: `No tool call — defaulting to ${d.decision}.` });
    return d;
  }

  const input = toolUse.input as { severity?: unknown; decision?: unknown; rationale?: unknown };
  const severity: Severity = isSeverity(input.severity) ? input.severity : "low";
  const decision: "halt" | "monitor" = input.decision === "halt" ? "halt" : "monitor";
  const rationale =
    typeof input.rationale === "string" && input.rationale.trim().length > 0
      ? input.rationale.trim()
      : "(no rationale given)";
  return { severity, decision, rationale };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @reineira-os/x402-rss-demo run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/demo/lib/incidentAgent.ts
git commit -m "feat(demo): incident-manager classifier agent"
```

---

## Task 5: Incident config + low-level on-chain helpers

**Files:**
- Create: `apps/demo/lib/incident.ts` (config + helpers; orchestrator added in Task 6)

Context: mirrors `lib/twoKey.ts` `clients()`/`vaultState()` and the bond-stake fallback, plus `lib/coverage.ts` for the coverage ABIs and `purchaseCoverage` shape, and `app/api/coverage/claim/route.ts` for the `dispute`/balance-delta payout. This task creates the config + reusable helpers; Task 6 adds `runIncidentResponse`.

- [ ] **Step 1: Write config + clients + ABIs + helpers**

Create `apps/demo/lib/incident.ts`:

```typescript
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
import { coverageManagerAbi, insurancePoolAbi } from "./coverage";

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
  backendKey: Hex; // creates escrows, runs the staged attacker, restores the vault
  guardianKey: Hex; // PAUSER_ROLE
  sentinelKey: Hex; // the agent's bond account
  depositorKey: Hex; // coverage holder / payout recipient
  facilitatorUrl: string;
  rpcUrl: string;
}

export function getIncidentConfig(): IncidentConfig | null {
  const e = process.env;
  const required = [
    e.VAULT_ADDRESS, e.ALERT_RESOLVER_ADDRESS, e.ESCROW_ADDRESS, e.X402_RECEIVER_ADDRESS,
    e.COVERAGE_MANAGER_ADDRESS, e.COVERAGE_POOL_ADDRESS, e.ALERT_POLICY_ADDRESS,
    e.SELLER_PRIVATE_KEY, e.GUARDIAN_PRIVATE_KEY, e.SENTINEL_PRIVATE_KEY, e.DEPOSITOR_PRIVATE_KEY,
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
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "recordedFloor", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "demoDrain", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "pause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "unpause", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

export const alertResolverAbi = [
  { type: "function", name: "isConditionMet", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isBreached", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "latchBreach", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
] as const;

export const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export const DRAIN_ATOMIC = 100_000n;
export const arbiscan = (tx: string) => `https://sepolia.arbiscan.io/tx/${tx}`;
export const fmt = (atomic: bigint) => `${(Number(atomic) / 1e6).toFixed(2)} USDC`;
export const STEP_MS = 900;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function clients(cfg: IncidentConfig) {
  const pub = createPublicClient({ chain: arbitrumSepolia, transport: http(cfg.rpcUrl) }) as PublicClient;
  const backend = privateKeyToAccount(cfg.backendKey);
  const guardian = privateKeyToAccount(cfg.guardianKey);
  const sentinel = privateKeyToAccount(cfg.sentinelKey);
  const depositor = privateKeyToAccount(cfg.depositorKey);
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
  return { pub, backend, guardian, sentinel, depositor, send, read };
}

// Create an AlertResolver-gated escrow (this snapshots the vault floor for `escrowId`).
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
    args: [beneficiary, amount, cfg.alertResolver, encodeAbiParameters([{ type: "address" }], [beneficiary])],
  });
  const escrowId = parseEventLogs({ abi: escrowAbi, eventName: "EscrowCreated", logs: created.rcpt.logs })[0]
    .args.escrowId as bigint;
  return { escrowId, tx: created.hash };
}

// Stake the sentinel's bond over x402 (EIP-3009), falling back to a direct escrow.fund().
// Mirrors lib/twoKey.ts stakeBondOverX402, but the bond amount is severity-scaled.
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
      resource: { url: "/api/resource", description: "Incident response bond", mimeType: "application/json" },
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
    await ctx.send(ctx.sentinel, { address: cfg.usdc, abi: erc20Abi, functionName: "approve", args: [cfg.escrow, bondAtomic] });
    const funded = await ctx.send(ctx.sentinel, { address: cfg.escrow, abi: escrowAbi, functionName: "fund", args: [escrowId, bondAtomic] });
    return { tx: funded.hash, viaX402: false };
  }
}

// Is the new alert policy allow-listed on the pool? Gates the live payout (graceful degrade).
export async function coverageReady(cfg: IncidentConfig, ctx: ReturnType<typeof clients>): Promise<boolean> {
  try {
    return await ctx.read<boolean>({ address: cfg.pool, abi: insurancePoolAbi, functionName: "isPolicy", args: [cfg.alertPolicy] });
  } catch {
    return false;
  }
}

export { coverageManagerAbi };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @reineira-os/x402-rss-demo run typecheck`
Expected: PASS. (`coverageManagerAbi`/`insurancePoolAbi` are exported from `lib/coverage.ts:15,97`; `escrowAbi`/`X402`/`ARBITRUM_SEPOLIA` from shared.)

- [ ] **Step 3: Commit**

```bash
git add apps/demo/lib/incident.ts
git commit -m "feat(demo): incident on-chain config + escrow/bond/coverage helpers"
```

---

## Task 6: The orchestrator — `runIncidentResponse`

**Files:**
- Modify: `apps/demo/lib/incident.ts` (append the orchestrator + a `purchaseVaultCoverage` helper)

Context: ties everything together. Branch logic per the spec state machine. The halt branch reuses the Two-Key choreography (small first-grab → pause → bond return on TP; pause-only → slash on FP). The FN branch uses the proven `dispute` + balance-delta payout from `app/api/coverage/claim/route.ts:96-128`.

- [ ] **Step 1: Append the coverage-purchase helper to `lib/incident.ts`**

```typescript
import { getReport, type IncidentReport } from "./incidentReports";
import { runIncidentAgent } from "./incidentAgent";
import { severityTier, type Severity } from "@reineira-os/x402-rss-shared";

// Buy coverage for the depositor on an AlertResolver-gated escrow. policyData mirrors
// lib/coverage.ts attachCoverage exactly: abi.encode([resolver, escrowId]).
async function purchaseVaultCoverage(
  cfg: IncidentConfig,
  ctx: ReturnType<typeof clients>,
  escrowId: bigint,
  amountAtomic: bigint,
): Promise<{ coverageId: bigint | null; tx: string | null; note: string | null }> {
  const block = await ctx.pub.getBlock({ blockTag: "latest" });
  const expiry = BigInt(Number(block.timestamp) + 600);
  const policyData = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [cfg.alertResolver, escrowId]);
  try {
    const { result, request } = await ctx.pub.simulateContract({
      account: ctx.backend,
      address: cfg.coverageManager,
      abi: coverageManagerAbi,
      functionName: "purchaseCoverage",
      args: [ctx.depositor.address, cfg.pool, cfg.alertPolicy, escrowId, amountAtomic, expiry, policyData, "0x"],
    });
    const hash = await (createWalletClient({ account: ctx.backend, chain: arbitrumSepolia, transport: http(cfg.rpcUrl) }).writeContract(request));
    const rcpt = await ctx.pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") return { coverageId: null, tx: hash, note: "coverage purchase reverted" };
    return { coverageId: result as bigint, tx: hash, note: null };
  } catch (error) {
    return { coverageId: null, tx: null, note: error instanceof Error ? error.message.split("\n")[0] : String(error) };
  }
}
```

- [ ] **Step 2: Append the orchestrator to `lib/incident.ts`**

```typescript
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
  if (!cfg) throw new Error("Incident Response is not configured (VAULT/ALERT_RESOLVER/ALERT_POLICY/COVERAGE/DEPOSITOR env missing)");
  const { emit } = args;
  const ctx = clients(cfg);
  const report = getReport(args.reportId);

  // STEP 0 — restore a healthy, unpaused vault; keep sentinel solvent for the bond.
  const paused = await ctx.read<boolean>({ address: cfg.vault, abi: vaultAbi, functionName: "paused" });
  if (paused) await ctx.send(ctx.guardian, { address: cfg.vault, abi: vaultAbi, functionName: "unpause" });
  let total = await ctx.read<bigint>({ address: cfg.vault, abi: vaultAbi, functionName: "totalAssets" });
  const floor = await ctx.read<bigint>({ address: cfg.vault, abi: vaultAbi, functionName: "recordedFloor" });
  if (total < floor) await ctx.send(ctx.backend, { address: cfg.vault, abi: vaultAbi, functionName: "deposit", args: [floor - total] });
  const maxBond = severityTier("critical").bondAtomic;
  const sentinelUsdc = await ctx.read<bigint>({ address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [ctx.sentinel.address] });
  if (sentinelUsdc < maxBond) await ctx.send(ctx.backend, { address: cfg.usdc, abi: erc20Abi, functionName: "transfer", args: [ctx.sentinel.address, maxBond * 3n] });
  emit({ zone: "vault", kind: "vault", state: "healthy", msg: "Vault healthy · monitored by the Incident Desk" });
  await sleep(STEP_MS);

  // STEP 1 — the report arrives.
  emit({ zone: "incident", kind: "report", source: report.source, title: report.title, body: report.body, claimedSeverity: report.severity, msg: `${report.source}: ${report.title}` });
  await sleep(STEP_MS);

  // STEP 2 — the depositor is insured against a vault breach (sized to the report's true severity).
  const payoutAtomic = severityTier(report.severity).payoutAtomic;
  const ready = await coverageReady(cfg, ctx);
  let coverageId: bigint | null = null;
  const covEscrow = await createGatedEscrow(cfg, ctx, ctx.depositor.address, payoutAtomic);
  if (ready) {
    const cov = await purchaseVaultCoverage(cfg, ctx, covEscrow.escrowId, payoutAtomic);
    coverageId = cov.coverageId;
    emit({ zone: "incident", kind: "coverage", msg: cov.coverageId ? `Depositor insured for ${fmt(payoutAtomic)} (coverage #${cov.coverageId}).` : `Coverage attach failed: ${cov.note}`, tx: cov.tx ?? undefined, arbiscan: cov.tx ? arbiscan(cov.tx) : undefined });
  } else {
    emit({ zone: "incident", kind: "coverage", msg: `Coverage pending one-time pool setup — depositor would be insured for ${fmt(payoutAtomic)}.`, label: "scripted" });
  }
  await sleep(STEP_MS);

  // STEP 3 — the agent triages and decides.
  const verdict = await runIncidentAgent({ report, emit, apiKey: args.apiKey });
  const bondAtomic = severityTier(verdict.severity).bondAtomic;
  emit({ zone: "incident", kind: "verdict", severity: verdict.severity, decision: verdict.decision, msg: `Verdict: ${verdict.severity.toUpperCase()} · ${verdict.decision.toUpperCase()} — ${verdict.rationale}` });
  await sleep(STEP_MS);

  // STEP 4 — branch.
  if (verdict.decision === "halt") {
    const bondEscrow = await createGatedEscrow(cfg, ctx, ctx.sentinel.address, bondAtomic);
    const bond = await stakeBond(cfg, ctx, bondEscrow.escrowId, bondAtomic);
    emit({ zone: "incident", kind: "bond", msg: `Agent stakes a ${fmt(bondAtomic)} bond on its ${verdict.severity} halt call (escrow #${bondEscrow.escrowId}). A wrong freeze forfeits it.`, tx: bond.tx, arbiscan: arbiscan(bond.tx) });
    await sleep(STEP_MS);

    if (report.realVuln) {
      // TP — a real exploit gets a first grab; the freeze stops the rest; the alarm is justified.
      const drained = await ctx.send(ctx.backend, { address: cfg.vault, abi: vaultAbi, functionName: "demoDrain", args: [DRAIN_ATOMIC] });
      await ctx.send(ctx.sentinel, { address: cfg.alertResolver, abi: alertResolverAbi, functionName: "latchBreach", args: [bondEscrow.escrowId] });
      emit({ zone: "incident", kind: "breach", label: "staged", msg: "Staged exploit lands a first grab below the floor — the breach is real.", tx: drained.hash, arbiscan: arbiscan(drained.hash) });
      const pausedTx = await ctx.send(ctx.guardian, { address: cfg.vault, abi: vaultAbi, functionName: "pause" });
      emit({ zone: "incident", kind: "halt", msg: "Guardian freezes the vault — the rest of the funds are safe.", tx: pausedTx.hash, arbiscan: arbiscan(pausedTx.hash) });
      await sleep(STEP_MS);
      const redeemed = await ctx.send(ctx.sentinel, { address: cfg.escrow, abi: escrowAbi, functionName: "redeem", args: [bondEscrow.escrowId] });
      emit({ zone: "incident", kind: "settle", msg: `Verdict VALID — bond returned. The correct freeze is rewarded.`, tx: redeemed.hash, arbiscan: arbiscan(redeemed.hash) });
      await ctx.send(ctx.guardian, { address: cfg.vault, abi: vaultAbi, functionName: "unpause" });
      await ctx.send(ctx.backend, { address: cfg.vault, abi: vaultAbi, functionName: "deposit", args: [DRAIN_ATOMIC] });
      emit({ zone: "system", label: "ledger", msg: "LIVE: bond stake, on-chain breach, Guardian freeze, bond return. STAGED: the exploit tx." });
      return { outcome: "TP", reportId: report.id, severity: verdict.severity, decision: verdict.decision };
    }

    // FP — the report was bogus; the vault is provably healthy; the bond is slashed.
    const pausedTx = await ctx.send(ctx.guardian, { address: cfg.vault, abi: vaultAbi, functionName: "pause" });
    emit({ zone: "incident", kind: "halt", msg: "Guardian freezes the vault on the agent's call.", tx: pausedTx.hash, arbiscan: arbiscan(pausedTx.hash) });
    await sleep(STEP_MS);
    try {
      await ctx.send(ctx.sentinel, { address: cfg.escrow, abi: escrowAbi, functionName: "redeem", args: [bondEscrow.escrowId] });
    } catch {
      /* redeem reverts ConditionNotMet — the bond is locked (slashed) */
    }
    emit({ zone: "incident", kind: "slash", msg: `Verdict FALSE — the resolver reads the vault as healthy. The ${fmt(bondAtomic)} bond is slashed. A false alarm costs the agent by criticality.` });
    const unpaused = await ctx.send(ctx.guardian, { address: cfg.vault, abi: vaultAbi, functionName: "unpause" });
    emit({ zone: "vault", kind: "vault", state: "healthy", msg: "Guardian unpauses — vault healthy.", tx: unpaused.hash, arbiscan: arbiscan(unpaused.hash) });
    emit({ zone: "system", label: "ledger", msg: "LIVE: bond stake, Guardian pause/unpause, on-chain verdict. The false alarm forfeited the bond." });
    return { outcome: "FP", reportId: report.id, severity: verdict.severity, decision: verdict.decision };
  }

  // decision === "monitor"
  if (report.realVuln) {
    // FN (HAPPY) — the agent missed it; the vault drains; the insured pool makes the depositor whole.
    const drained = await ctx.send(ctx.backend, { address: cfg.vault, abi: vaultAbi, functionName: "demoDrain", args: [DRAIN_ATOMIC] });
    await ctx.send(ctx.sentinel, { address: cfg.alertResolver, abi: alertResolverAbi, functionName: "latchBreach", args: [covEscrow.escrowId] });
    emit({ zone: "incident", kind: "breach", label: "staged", msg: "Agent chose to monitor — the exploit drains the vault below its floor.", tx: drained.hash, arbiscan: arbiscan(drained.hash) });
    await sleep(STEP_MS);

    if (ready && coverageId !== null) {
      const balBefore = await ctx.read<bigint>({ address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [ctx.depositor.address] });
      const disputeTx = await ctx.send(ctx.depositor, { address: cfg.coverageManager, abi: coverageManagerAbi, functionName: "dispute", args: [coverageId, "0x"] });
      const balAfter = await ctx.read<bigint>({ address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [ctx.depositor.address] });
      const delta = balAfter > balBefore ? balAfter - balBefore : 0n;
      emit({ zone: "incident", kind: "payout", msg: `Insurance pool pays the depositor ${fmt(delta)} — compensation by severity.`, tx: disputeTx.hash, arbiscan: arbiscan(disputeTx.hash) });
    } else {
      emit({ zone: "incident", kind: "payout", label: "scripted", msg: `Coverage pending one-time setup — the pool would pay the depositor ${fmt(payoutAtomic)}.` });
    }
    // restore for the next run
    await ctx.send(ctx.backend, { address: cfg.vault, abi: vaultAbi, functionName: "deposit", args: [DRAIN_ATOMIC] });
    emit({ zone: "system", label: "ledger", msg: "LIVE: coverage attach, on-chain breach, pool payout. STAGED: the exploit tx + detection." });
    return { outcome: "FN", reportId: report.id, severity: verdict.severity, decision: verdict.decision };
  }

  // TN — no real vuln, no action.
  emit({ zone: "incident", kind: "settle", msg: "No credible exploit — the agent holds. No freeze, no claim." });
  return { outcome: "TN", reportId: report.id, severity: verdict.severity, decision: verdict.decision };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @reineira-os/x402-rss-demo run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/demo/lib/incident.ts
git commit -m "feat(demo): runIncidentResponse orchestrator (TP/FN/FP/TN branches)"
```

---

## Task 7: Wire the orchestrator into the run API

**Files:**
- Modify: `apps/demo/app/api/run/route.ts`

Context: the SSE `GET` handler branches on `mode` and already handles `mode === "twokey"` by calling `runTwoKeyHalt({ emit, forceFalseAlarm })` then `emit({ done: true })` (`route.ts:~647`). Add a sibling branch. The `emit` closure and `report` query are read from the request URL like the existing handler reads `mode`/`falseAlarm`.

- [ ] **Step 1: Add the import**

At the top of `apps/demo/app/api/run/route.ts`, alongside the existing `runTwoKeyHalt` import, add:

```typescript
import { runIncidentResponse } from "@/lib/incident";
```
(Match the existing import style for `lib/*` in that file — if it uses a relative path like `../../../lib/twoKey`, mirror that path for `lib/incident`.)

- [ ] **Step 2: Add the mode branch**

Immediately after the existing `if (mode === "twokey") { … return; }` block inside the stream `start`, add:

```typescript
if (mode === "incident") {
  const reportId = url.searchParams.get("report");
  await runIncidentResponse({ emit, reportId, apiKey: process.env.ANTHROPIC_API_KEY });
  emit({ done: true });
  return;
}
```
(`url` is the already-parsed `new URL(request.url)` used to read `mode`; reuse it. If the existing code names it differently, match that name.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @reineira-os/x402-rss-demo run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/demo/app/api/run/route.ts
git commit -m "feat(demo): /api/run?mode=incident streams the incident scenario"
```

---

## Task 8: Incident Response scenario UI

**Files:**
- Create: `apps/demo/app/incident-response/page.tsx`
- Create: `apps/demo/app/components/IncidentResponseTheater.tsx`
- Create: `apps/demo/app/components/IncidentResponseTheater.module.css`
- Modify: `apps/demo/app/components/Sidebar.tsx`

Context: mirror the Two-Key scenario. `TwoKeyTheater.tsx` is the template: client component, `fetch('/api/run?mode=…')`, read the SSE `ReadableStream` (`buffer.split("\n\n")`, parse `data: ` frames), dispatch to `handleEvent`, render a log of `{ zone, msg, tx, arbiscan, label }` rows. Reuse the same design tokens (`var(--accent-blue)`, `var(--card-grad)`, etc.).

- [ ] **Step 1: Create the page**

Create `apps/demo/app/incident-response/page.tsx`:

```tsx
import { IncidentResponseTheater } from "../components/IncidentResponseTheater";

export default function IncidentResponsePage() {
  return (
    <div className="ws">
      <IncidentResponseTheater />
    </div>
  );
}
```

- [ ] **Step 2: Add the sidebar entry**

In `apps/demo/app/components/Sidebar.tsx`, add to the `SHOWCASES` array (after the `two-key` entry, ~line 19):

```tsx
{ href: "/incident-response", label: "Incident Response", icon: "alert", match: (p) => p.startsWith("/incident-response") },
```
(If the `icon` value `"alert"` is not a registered icon name in the project's `Icon` component, use an existing one such as `"lock"` or `"play"` — check the Icon name union before committing.)

- [ ] **Step 3: Create the theater component**

Create `apps/demo/app/components/IncidentResponseTheater.tsx`. Copy the structural shell (imports, `"use client"`, the `useState`/`useCallback`/`useRef` scaffolding, the SSE `fetch`+reader loop, the `LogRow`/`TxLink` render helpers, the outer card/controls layout) from `TwoKeyTheater.tsx`, and replace the scenario-specific pieces with the below. The full logic you must implement:

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { INCIDENT_REPORTS, DEFAULT_REPORT_ID } from "../../lib/incidentReports";
import styles from "./IncidentResponseTheater.module.css";

type RunEvent = Record<string, any>;
interface LogLine { zone: string; msg: string; tx?: string; arbiscan?: string; label?: string; ledger?: boolean; error?: boolean; }

export function IncidentResponseTheater() {
  const [reportId, setReportId] = useState(DEFAULT_REPORT_ID);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [verdict, setVerdict] = useState<{ severity: string; decision: string } | null>(null);
  const [thinking, setThinking] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const push = useCallback((line: LogLine) => setLog((l) => [...l, line]), []);

  const handleEvent = useCallback((event: RunEvent) => {
    if (event.done) { setRunning(false); return; }
    if (event.level === "error") { push({ zone: "system", msg: String(event.msg ?? "error"), error: true }); setRunning(false); return; }
    if (event.zone !== "incident" && event.zone !== "system" && event.zone !== "vault") return;

    // stream the agent's reasoning into a live "thinking" line rather than the log
    if (event.zone === "incident" && event.kind === "thinking") {
      if (event.streamEnd) return;
      if (event.stream) { setThinking((t) => t + String(event.msg ?? "")); return; }
      if (event.msg) setThinking(String(event.msg));
      return;
    }
    if (event.zone === "incident" && event.kind === "verdict") {
      setVerdict({ severity: String(event.severity), decision: String(event.decision) });
    }
    if (event.msg) {
      push({
        zone: event.zone,
        msg: String(event.msg),
        tx: event.tx,
        arbiscan: event.arbiscan,
        label: event.label === "staged" || event.label === "scripted" ? event.label : undefined,
        ledger: event.label === "ledger",
      });
    }
  }, [push]);

  const run = useCallback(async () => {
    if (running) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true); setLog([]); setVerdict(null); setThinking("");

    try {
      const res = await fetch(`/api/run?mode=incident&report=${encodeURIComponent(reportId)}`, { cache: "no-store", signal: controller.signal });
      if (!res.body) throw new Error("no response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try { handleEvent(JSON.parse(dataLine.slice(6)) as RunEvent); } catch { /* ignore */ }
        }
      }
    } catch (e) {
      push({ zone: "system", msg: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setRunning(false);
    }
  }, [running, reportId, handleEvent, push]);

  return (
    <div className={styles.theater}>
      <header className={styles.head}>
        <h1>Incident Response</h1>
        <p>An incident-manager agent triages a vulnerability report and decides to freeze or hold — insured by the pool, bonded against false alarms.</p>
      </header>

      <div className={styles.controls}>
        <label className={styles.cap}>Incident report</label>
        <div className={styles.reports} role="group" aria-label="Pick a report">
          {INCIDENT_REPORTS.map((r) => (
            <button
              key={r.id}
              className={`${styles.report}${reportId === r.id ? ` ${styles["report--on"]}` : ""}`}
              onClick={() => setReportId(r.id)}
              disabled={running}
            >
              <span className={styles.report__src}>{r.source}</span>
              <span className={styles.report__title}>{r.title}</span>
            </button>
          ))}
        </div>
        <button className={styles.run} onClick={() => void run()} disabled={running}>
          {running ? "Running…" : "Run incident response"}
        </button>
      </div>

      {thinking ? (
        <div className={styles.thinking}><span className={styles.cap}>Agent</span><p>{thinking}</p></div>
      ) : null}
      {verdict ? (
        <div className={styles.verdict}>
          <span className={`${styles.badge} ${styles[`badge--${verdict.severity}`] ?? ""}`}>{verdict.severity}</span>
          <span className={`${styles.badge} ${styles[`badge--${verdict.decision}`] ?? ""}`}>{verdict.decision}</span>
        </div>
      ) : null}

      <div className={styles.log}>
        {log.map((line, i) => (
          <div key={i} className={`${styles.row}${line.ledger ? ` ${styles["row--ledger"]}` : ""}${line.error ? ` ${styles["row--error"]}` : ""}`}>
            <span className={`${styles.row__gutter} ${styles[`row__gutter--${line.zone}`] ?? ""}`}>{line.ledger ? "ledger" : line.zone}</span>
            <span className={styles.row__body}>
              {line.msg}
              {line.label ? <span className={`${styles.chip} ${styles[`chip--${line.label}`] ?? ""}`}>{line.label.toUpperCase()}</span> : null}
              {line.tx ? <a className={styles.tx} href={line.arbiscan ?? `https://sepolia.arbiscan.io/tx/${line.tx}`} target="_blank" rel="noreferrer">tx ↗</a> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the styles**

Create `apps/demo/app/components/IncidentResponseTheater.module.css`. Reuse the design tokens used by `TwoKeyTheater.module.css` (do not invent raw colors). Minimum:

```css
.theater { display: flex; flex-direction: column; gap: var(--space-12, 12px); }
.head h1 { font-size: 20px; font-weight: 600; color: var(--text-primary); }
.head p { color: var(--text-dim); font-size: 13px; max-width: 60ch; }
.controls { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border-dark); border-radius: var(--r-card); background: var(--card-grad); }
.cap { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); }
.reports { display: flex; gap: 6px; flex-wrap: wrap; }
.report { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; flex: 1 1 200px; padding: 8px 10px; text-align: left; border: 1px solid var(--border-dark); border-radius: var(--r-sub); background: var(--tile-bg); color: var(--text-dim); cursor: pointer; transition: border-color var(--dur-1) var(--ease), color var(--dur-1) var(--ease); }
.report--on { border-color: var(--blue-25); color: var(--accent-blue); background: var(--blue-8); }
.report__src { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.8; }
.report__title { font-size: 13px; color: var(--text-secondary); }
.run { min-height: 40px; padding: 0 20px; font-size: 14px; font-weight: 600; color: #fff; background: var(--accent-blue); border: 1px solid var(--accent-blue); border-radius: var(--r-btn); cursor: pointer; }
.run:disabled { opacity: 0.6; cursor: not-allowed; }
.thinking { padding: 10px 12px; border: 1px solid var(--border-dark); border-radius: var(--r-sub); background: var(--tile-bg); }
.thinking p { font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary); white-space: pre-wrap; }
.verdict { display: flex; gap: 6px; }
.badge { font-size: 11px; font-weight: 600; text-transform: uppercase; padding: 3px 8px; border-radius: var(--r-sub); background: var(--tile-bg); color: var(--text-secondary); border: 1px solid var(--border-dark); }
.badge--critical, .badge--high { color: var(--st-spec-text); border-color: rgba(243, 166, 40, 0.4); }
.badge--halt { color: var(--accent-blue); border-color: var(--blue-25); }
.log { display: flex; flex-direction: column; gap: 4px; font-family: var(--font-mono); font-size: 12px; }
.row { display: flex; gap: 10px; padding: 4px 0; }
.row--error { color: #ff6b6b; }
.row--ledger { color: var(--text-dim); font-style: italic; }
.row__gutter { flex: 0 0 72px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; color: var(--text-dim); }
.row__gutter--incident { color: var(--accent-blue); }
.row__gutter--vault { color: var(--accent-steel); }
.row__gutter--system { color: var(--text-dim); }
.row__body { flex: 1; color: var(--text-secondary); }
.chip { margin-left: 8px; font-size: 9px; padding: 1px 5px; border-radius: 4px; background: var(--tile-bg); color: var(--text-dim); }
.chip--staged { color: var(--st-spec-text); }
.tx { margin-left: 8px; color: var(--accent-blue); text-decoration: none; }
```
(If any token name above doesn't exist in the project's CSS variables, substitute the nearest existing token found in `TwoKeyTheater.module.css` — match, don't invent.)

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @reineira-os/x402-rss-demo run typecheck`
Expected: PASS. (Fix any `Icon` name or CSS-module-class type issues surfaced here.)

- [ ] **Step 6: Commit**

```bash
git add apps/demo/app/incident-response/page.tsx apps/demo/app/components/IncidentResponseTheater.tsx apps/demo/app/components/IncidentResponseTheater.module.css apps/demo/app/components/Sidebar.tsx
git commit -m "feat(demo): Incident Response scenario UI"
```

---

## Task 9: End-to-end manual verification (all branches)

No unit harness exists for the on-chain/LLM flow, so verify by driving the running app and reading the streamed events + Arbiscan. The facilitator (`:4021`) and demo (`:3000`) should be running (see project run notes).

- [ ] **Step 1: Set env + restart**

Add `ALERT_POLICY_ADDRESS` and `DEPOSITOR_PRIVATE_KEY` to `apps/demo/.env.local`. Fund the depositor EOA with a little Arbitrum Sepolia ETH (gas) and ensure the sentinel has testnet USDC (Step 0 of the orchestrator tops it up from the backend). Restart `next dev`.

- [ ] **Step 2: FP branch (false alarm → slash)**

Run: `curl -N "http://localhost:3000/api/run?mode=incident&report=anon-rumor"`
Expected SSE frames include: `kind:"report"` (anon rumor), `kind:"thinking"`, `kind:"verdict"` with `decision:"halt"`, `kind:"halt"` (pause tx), `kind:"slash"` ("bond is slashed"), then a `ledger` line and `done`. Open the pause tx on Arbiscan to confirm it landed.
Expected verdict: a well-behaved agent halts on the urgent (but bogus) report → FP. If the model instead monitors, that's a legitimate TN — note it; the preset is tuned to elicit a halt.

- [ ] **Step 3: TP branch (correct halt → bond returned)**

Run: `curl -N "http://localhost:3000/api/run?mode=incident&report=immunefi-reentrancy"`
Expected: `verdict` `decision:"halt"`, `kind:"breach"` (demoDrain tx), `kind:"halt"` (pause tx), `kind:"settle"` ("bond returned"). Confirm the redeem tx on Arbiscan.

- [ ] **Step 4: FN branch (missed vuln → pool pays)**

Run: `curl -N "http://localhost:3000/api/run?mode=incident&report=hackenproof-rounding"`
Expected: `verdict` `decision:"monitor"`, `kind:"breach"` (demoDrain tx), and either `kind:"payout"` with a non-zero `… pays the depositor X USDC` (if `ALERT_POLICY_ADDRESS` is pool-registered) or a `scripted` "coverage pending one-time setup" note (if not). If a live payout is expected, confirm the depositor's USDC balance increased and open the `dispute` tx on Arbiscan.

- [ ] **Step 5: UI smoke**

Open `http://localhost:3000/incident-response`. Pick each report, click "Run incident response", and confirm: the agent's reasoning streams into the "Agent" panel, the severity/decision badges render, the log rows show the branch with working `tx ↗` links, and the layout matches the Two-Key scenario's polish (one block system). Look at the page — a blank panel is a failure.

- [ ] **Step 6: Final commit (docs/env)**

Update `DEPLOY.md` with the two new env vars and the one-time `pool.addPolicy(ALERT_POLICY_ADDRESS)` step.

```bash
git add DEPLOY.md
git commit -m "docs: incident-response env + pool policy registration"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** Roles (Task 6 STEP 1–4), branches TP/FN/FP/TN (Task 6 STEP 4), severity model (Task 2), preset reports (Task 3), LLM judgment (Task 4), new policy deploy + reuse (Task 1), event/UI model + zones/kinds (Task 8), error handling — graceful coverage degrade (Task 5 `coverageReady`, Task 6 STEP 2/FN), idempotent restore (Task 6 STEP 0). All spec sections map to a task.
- **Open risk — `purchaseCoverage`/`dispute` permissions:** the existing `attachCoverage` (caller = backend, holder = a treasury) and `app/api/coverage/claim/route.ts` (caller = holder treasury) prove the path with the *delivery* policy. The new alert policy is the same `DeliveryPolicy` bytecode pointed at a different resolver, so `judge`/`dispute` behave identically — but the FIRST live run of Task 9 Step 4 is the real proof. If `dispute` reverts with a permission error, check who the deployed CoverageManager expects as the `dispute` caller (holder vs. insurance-manager) and adjust the `ctx.depositor` signer accordingly.
- **`policyData` encoding:** intentionally mirrors `lib/coverage.ts:259-262` verbatim (`abi.encode([resolver, escrowId])`) even though `DeliveryPolicy.onPolicySet` decodes `(uint256)` — the deployed CoverageManager evidently forwards a transformed payload that makes the working delivery flow succeed. Do not "fix" the encoding; match what works, and confirm in Task 9 Step 4.
- **Type consistency:** `Severity`, `severityTier`, `SEVERITY_TIERS` (Task 2) are used unchanged in Tasks 3/4/6. `IncidentEmit`/`clients`/`createGatedEscrow`/`stakeBond`/`coverageReady`/`coverageManagerAbi` (Task 5) are all consumed by Task 6. Event `zone`/`kind` vocabulary (`incident` + `report|thinking|verdict|bond|breach|halt|settle|slash|coverage|payout`) emitted in Task 6 matches `handleEvent` in Task 8.

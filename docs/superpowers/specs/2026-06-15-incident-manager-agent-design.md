# Incident-Manager Agent — Insured Incident Response

**Date:** 2026-06-15
**Status:** Design approved, pending implementation plan

## Summary

A new demo scenario in which an **Incident-Manager Agent (IMA)** watches a smart
contract (`ProtectedVault`), reads incoming vulnerability reports, classifies their
severity, and decides whether to halt the contract. The scenario demonstrates the
protocol's insured-settlement thesis through two error branches with real on-chain
economic consequences:

- **Happy flow (false negative):** the agent fails to halt a contract with a real
  vulnerability, damage occurs, and the **insurance pool compensates the victim**,
  scaled by severity.
- **Unhappy flow (false positive):** the agent halts on a bogus report, and its
  **staked bond is slashed**, scaled by the criticality it claimed.

This composes existing, already-deployed protocol primitives. There is **no new
Solidity logic** — only one additional deployment of an existing contract plus
off-chain agent, severity model, preset reports, and a new UI scenario.

## Goals

- Show an agentic incident-response loop end-to-end, settling on-chain.
- Reuse the existing Two-Key Halt (`ProtectedVault` + `AlertResolver` + Guardian +
  x402 bond) and insurance (`CoverageManager`/`CoveragePool` + `DeliveryPolicy`)
  rails as-is.
- Make the agent's halt/no-halt decision a genuine LLM judgment, while keeping the
  demo reliably steerable into each branch via preset reports.

## Non-Goals

- No live external bug-bounty feed integration (presets only).
- No partial bond slashing (full forfeit of a severity-scaled bond instead).
- No new on-chain protocol mechanics; severity is expressed purely through amounts
  passed to existing functions.

## Roles

- **Incident-Manager Agent (IMA)** — new Claude-driven agent. Watches
  `ProtectedVault`, holds a treasury, and stakes a **bond** (size proportional to
  the severity it claims) backing its judgment. Reads a report, assigns a severity
  tier (Low/Medium/High/Critical), and decides **halt** or **monitor** with a
  rationale. Streams its reasoning into the transcript.
- **Guardian** — existing key holding `PAUSER_ROLE`. When the IMA decides to halt,
  the Guardian calls `vault.pause()`. The IMA recommends; the Guardian executes —
  preserving the two-key separation (the IMA cannot itself move or freeze funds).
- **Depositor (victim)** — holds **coverage** on the vault via `CoverageManager`,
  with the policy bound to `AlertResolver`. On a real breach, `CoveragePool`
  compensates the depositor, scaled by severity.
- **Staged attacker** — backend (`DEMO_ROLE`) calls `vault.demoDrain()` to simulate
  the exploit. Reverts if the vault is paused. Already exists.

## Branches (state machine)

Per-run setup: the vault is funded (recorded floor set) and the depositor holds
coverage on it (cap sized to the largest payout tier). The IMA does **not**
pre-stake. It stakes a bond only when it decides to **halt** (an x402 EIP-3009
authorization into an escrow tied to `AlertResolver`), so the bond is at risk only
on the alarm-raising path. This also removes the ordering paradox of sizing a bond
"by severity" before the agent has assigned one.

- **TP — correct halt (baseline / contrast):** report is real → IMA halts → it
  stakes a bond (∝ the severity it claims) backing the alarm → Guardian pauses →
  `demoDrain` reverts → vault safe → IMA bond returned. No payout.
- **FN — missed vulnerability (point 2, HAPPY):** report is real, IMA does *not*
  halt (under-rates it) → no bond is staked → attacker calls `demoDrain` →
  `totalAssets < floor` → `AlertResolver.latchBreach` → depositor files a claim →
  `DeliveryPolicy.judge` reads `AlertResolver.isBreached == true` → **`CoveragePool`
  pays the depositor**, amount scaled by the actual incident severity (drain
  magnitude from the report's ground truth), capped by coverage. Narrative: the
  agent erred, but the insured pool made the victim whole.
- **FP — false alarm (point 3, UNHAPPY):** report is bogus, IMA halts anyway → it
  stakes a bond (∝ the criticality it claims) → vault paused but
  `AlertResolver.isBreached == false` (no drain) → verdict INVALID → **IMA bond
  slashed** (forfeited) in full. Narrative: the false alarm cost the agent its bond.
- **TN — no vulnerability, no halt:** nothing happens. Optional, not a focus.

## Severity model

Severity enters in two distinct places:

- **Bond size** ∝ the severity the agent *claims* when it raises an alarm (its skin
  in the game), forfeited in full on a false positive — the penalty "by criticality".
- **Payout size** ∝ the *actual* incident severity (the drain magnitude), capped by
  the depositor's coverage — the compensation "by severity".

Four tiers. Both scales are expressed only through amounts passed to existing
functions, with no contract change. Testnet-scale USDC (1 USDC = 1e6 atomic).
Numbers are tunable.

| Severity | IMA bond (forfeit on FP) | Coverage payout (on FN) |
|----------|--------------------------|-------------------------|
| Low      | 0.05 USDC                | 0.10 USDC               |
| Medium   | 0.10 USDC                | 0.25 USDC               |
| High     | 0.25 USDC                | 0.50 USDC               |
| Critical | 0.50 USDC                | 1.00 USDC               |

- Penalty "by criticality" = forfeit the whole severity-scaled bond (no partial
  slash — simpler, no contract change).
- Compensation "by severity" = the pool pays the severity-scaled coverage amount.

## Components

### New (off-chain)

- `apps/demo/lib/incidentReports.ts` — preset report fixtures:
  `{ id, source ("Immunefi" | "HackenProof" | "anon rumor"), title, body,
  affectedContract, groundTruth: "real" | "fake", intendedBranch: "TP" | "FN" | "FP" }`.
  A small set chosen to drive each branch.
- `apps/demo/lib/incidentAgent.ts` — Claude agent modeled on `sellerAgent.ts`:
  system prompt plus a `classify_incident` tool returning
  `{ severity, decision: "halt" | "monitor", rationale }`. Streams reasoning to the
  transcript.
- `packages/shared/src/severity.ts` (re-exported from `packages/shared/src/index.ts`,
  package `@reineira-os/x402-rss-shared`) — tier → bond/coverage amount mapping (the
  table above) plus a `Severity` type.
- `apps/demo/app/api/incident/route.ts` — run orchestrator modeled on
  `run/route.ts`: setup → stake bond → run IMA → branch (halt via Guardian /
  no-halt) → settle (`latchBreach` + pool payout, or bond slash) → emit transcript
  events. Reuses helpers from `twoKey.ts` and `coverage.ts`.

### Reused as-is

`ProtectedVault`, `AlertResolver`, `CoverageManager`/`CoveragePool`, x402 bond
escrow + EIP-3009, Guardian pause, the transcript/zone event model, the facilitator.

### New on-chain (deployment only, no new logic)

One deployment of `DeliveryPolicy(coverageManager, alertResolver)`. `DeliveryPolicy`
is resolver-agnostic — its constructor takes `resolver_` and `judge()` calls
`IBreachOracle(resolver).isBreached(escrowId)` (`DeliveryPolicy.sol:31,59`), and
`AlertResolver` already implements `isBreached(uint256)`. For public-release naming
clarity, an optional alias rename to `BreachPolicy` may be considered at plan time
(cosmetic only).

## Data flow (FN / happy, as example)

```
operator picks report → POST /api/incident
  ├─ setup: vault.deposit (floor), depositor.purchaseCoverage(cap)
  ├─ IMA.classify_incident(report) → {severity, decision}  (streamed to UI)
  ├─ decision == "monitor" (FN branch, no bond staked):
  │    demoDrain() → AlertResolver.latchBreach() → CoverageManager claim
  │    → DeliveryPolicy.judge == true → CoveragePool → depositor paid ∝ actual sev
  └─ emit: report, thinking, verdict, breach, payout
```

FP branch: `decision == "halt"` while `groundTruth == "fake"` →
`IMA.stakeBondOverX402(∝ claimed sev)` → `vault.pause()` → `isBreached == false` →
verdict INVALID → bond forfeited → emit `halt`, `slash`.

## Event / UI model

Reuse the transcript zone/kind model. Add an `"incident"` zone with kinds: `report`,
`thinking` (IMA stream), `verdict` (severity + decision badge), `halt`, `breach`,
`payout`, `slash`. The UI renders one coherent timeline in the existing single
block-design system (Linear/Cursor-grade per the design north-star) via a new
"Incident Response" scenario panel alongside the existing scenarios.

## Error handling

- Facilitator/bond stake unreachable → fall back to a direct `escrow.fund()`
  (already done in `twoKey.ts`).
- IMA returns a malformed classification → clamp to a safe default (`monitor` /
  no-halt + flag) and surface it in the UI.
- Pause already set / breach already latched → idempotent (`latchBreach` is
  idempotent).
- Coverage not ready (policy not registered) → precheck via the existing
  `coverageReadiness()`; block the run with a clear message.

## Testing

- **Contract:** Foundry test (`forge test`) deploying `DeliveryPolicy(cm,
  alertResolver)` and asserting that `judge` follows `AlertResolver.isBreached`
  across breach/no-breach states. Reuses existing `*.t.sol` patterns.
  (`packages/contracts` is a Foundry project, not Hardhat, despite the repo-level
  CLAUDE.md note.)
- **Agent:** unit test of IMA classification on each preset (deterministic via
  fixtures / mocked model).
- **Flow:** an e2e script (like the existing one) driving each branch (TP/FN/FP) and
  asserting the on-chain end state (paused / breached + payout / bond forfeited).

## Open items for the implementation plan

- Final severity amounts (table above is a placeholder scale).
- Whether to alias `DeliveryPolicy` → `BreachPolicy` for naming clarity.
- Exact preset report set and their ground-truth/branch mapping.

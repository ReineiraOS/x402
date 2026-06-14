# x402-rss — code + design review & polish (2026-06-14)

Multi-dimension review (10 reviewers + adversarial verification, 44 agents). Baseline before:
forge 27/27, core 68, facilitator/x402-rss green, demo tsc clean; **1 failing test** (shared escrowAbi).
68 confirmed findings, 3 rejected. Committed code is solid; issues cluster in WIP, docs-honesty, FE/design polish.

## Tier 1 — real bugs / broken
- [ ] shared/abis.ts: add `fund(uint256,uint256)`, drop dead+wrong `isFunded`; fix shared test → green
- [ ] scripts/twokey-proof.ts: drain BEFORE pause (whenNotPaused) so the VALID proof can complete
- [ ] SettlementTheater: `finally { setRunning(false) }` (stuck-on-Running), abort run on unmount
- [ ] SettlementTheater: breach state must not show dead "Release →" (per-row + batch); show File claim
- [ ] run/route.ts: idempotency guard (no double-charge), client-abort handling, error-path transcript persist
- [ ] page.tsx + agents/[id] + edit: try/catch/finally on fetch (stuck spinner)

## Tier 2 — honesty / docs
- [ ] apps/demo/README.md: rewrite (stale SKELETON / batch-inference / x-payment)
- [ ] facilitator + x402-rss READMEs: drop @x402/* runtime-dep overclaim; remove A3 ticket leak
- [ ] root README: add packages/core; rss package.json/README: IFundingSource conformance overclaim
- [ ] IEscrow.sol fund sig vs deployed; IUnderwriterPolicy dangling ref; X402EscrowReceiver DEV-191 leak

## Tier 3 — design polish (within @reineira-os/ui brand)
- [ ] layout.tsx: no-flash theme init script (FOUC)
- [ ] globals: `.term__tab--active` → `--tile-bg` (invisible in light); empty `.pipe__zone--right`; dup base rules
- [ ] globals: remove dead `.ws` duplicate + ws__* family; tokens/compat: drop dead anim classes + aliases
- [ ] TwoKeyTheater.module.css: `.actor` resting shadow (flat in light); `.verdict` 800→700
- [ ] analytics: theme-aware chart palette

## Tier 4 — correctness (lower demo impact)
- [ ] sessionStore/agentStore: per-file async mutex (lost-update)
- [ ] treasury budget check-then-act → reserve; release route clock = max(local, chain)
- [ ] core settle non-escrow ERC-1271 branch; facilitator 400-vs-502 + body limit + /supported + cors
- [ ] http.ts decode guard; withdraw amount validation; misc nits

## Review section (2026-06-14)

### Verified green after all changes
forge: rss 5/5, contracts 29/29 · vitest: shared 4/4 (was 1 fail), core 68/68 (oracle parity intact),
facilitator 9/9, x402-rss 7/7 · demo `tsc --noEmit` clean · `next build` passes · prettier clean on all
touched .ts/.tsx. Dev server :3000 + facilitator :4021 live (200).

### Applied
- **shared/abis.ts**: added `fund(uint256,uint256)` (matches deployed escrow), dropped dead+wrong
  `isFunded`/`status`; test now asserts `fund`+`getPaidAmount`. Fixes the only failing test + the
  twoKey runtime AbiFunctionNotFound.
- **scripts/twokey-proof.ts**: drain BEFORE pause (demoDrain is whenNotPaused) so the VALID proof runs.
- **SettlementTheater**: `finally{setRunning(false)}` (stuck-on-Running), abort run on unmount, breach
  excluded from Release (per-row + batch), modal Escape+aria-labelledby, aria-live console, auto-scroll,
  cmd reflects selected resource. **NEW granular deal pipeline** (Request→Authorize→Escrow→[Coverage]→
  Data Desk→Settled) with live status strip (countdown / File claim / released) replacing the 3-node pipe.
- **pages**: dashboard + agent detail + edit — try/catch/finally on fetch (no stuck spinner).
- **api/run**: idempotency guard (no double-charge), client-abort handling (signal+cancel+loop break),
  error-path transcript persistence, named MAX_AGENT_TURNS.
- **sessionStore + agentStore**: per-file async mutex (lost-update). release route clock = max(local,chain).
  withdraw amountAtomic validation (400).
- **core**: settle non-escrow ERC-1271 branch (bytes overload), verifyExact structural guard (malformed
  → structured invalid, not 502), http decode guard. **facilitator**: canonical /supported, 64KB bodyLimit.
- **docs (subagent)**: demo README rewrite (was SKELETON), facilitator/x402-rss/root README @x402 overclaim
  fixes, rss IFundingSource conformance narrowed, IUnderwriterPolicy dangling ref, X402EscrowReceiver DEV-191 leak.
- **css**: `.term__tab--active` → `--tile-bg` (light-mode), TwoKey `.actor` resting shadow, `.verdict` 800→700.
- **.gitignore**: tasks/review-workflow.js (absolute paths; pre-public hygiene).

### Deferred / handed to Vladimir (low collision-risk vs his live visual work)
- Dead `.pipe*` CSS now superseded by `.flow` — left in place so reverting the pipeline is trivial.
- Pre-existing prettier debt: ~37 committed files non-compliant (twoKey/sellerEscrow/sessionWallet etc.).
  Did NOT mass-reformat (would be a huge noise diff in his files). Run `npm run format` when ready.
- Remaining low/nits from the review (release payout balance-delta heuristic, insurance-manager slot read,
  seller truncation-vs-decline, dead `.ws` dup + dead anim classes/aliases, analytics chart light-theme,
  facilitator CORS posture). All non-blocking; full list in the workflow output.

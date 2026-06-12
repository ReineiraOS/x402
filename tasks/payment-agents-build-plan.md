# Payment Agents — BUILD PLAN & PROGRESS (durable; survives /compact)

Goal: a RUNNABLE-LOCALLY "Payment Agents" POC for a buildathon + builder showcase.
A user creates agents (pre-prompt + own ZeroDev smart wallet + N plugins); each agent autonomously
pays x402 from its OWN smart wallet into a plugin-gated escrow; user withdraws / sees spend analytics.

Companion docs: `tasks/x402-escrow-bridge-spec.md` (the bridge spec + Path A/B + verified findings).

## LOCKED DECISIONS

1. **Payer = the agent's ZeroDev Kernel SMART ACCOUNT itself (Path B)** via USDC's ERC-1271 `bytes`
   overload of `receiveWithAuthorization`. NOT an EOA. PROVEN LIVE (see "Verified" below).
2. **Payment lands in an ESCROW, not at the seller.** x402 `payTo` = the `X402EscrowReceiver`
   contract; `settle` pulls USDC via `receiveWithAuthorization(bytes)` then `escrow.fund(escrowId)`.
   Seller is released only when the escrow's condition resolver (a plugin) returns true; a mandatory
   TimeLock resolver auto-releases so funds never strand. `escrowId` is bound into the EIP-3009 `nonce`
   (`nonce == keccak256(abi.encode(escrowId, salt))`).
3. **Token = canonical USDC `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`** (has EIP-3009 + 1271 bytes
   overload — verified). NOT ConfidentialUSDC (FHE, no EIP-3009). FHE escrow deferred.
4. **REUSE the already-deployed plain `Escrow` `0xa125db70c1f17E395AfFa30b32e1e4A94aF3A81c`** (CORRECTED
   2026-06-10 — the user had already deployed a plain Escrow; found via SDK `constants/addresses.ts`
   `plainEscrow` + `docs/reference/deployed-contracts.md`, NOT in the escrow package deployments json).
   Verified on-chain: `paymentToken()` = canonical USDC `0x75faf…AA4d` ✓; `total()`=34. **It is an OLDER
   build** of Escrow.sol with the LEGACY api: has `create(address,uint256,address,bytes)`,
   `fund(uint256,uint256)`, `redeem(uint256)`, `getAmount/getPaidAmount/getOwner/getCaller/getConditionResolver/
   exists/total`, event `EscrowCreated`; **does NOT have** `budget()`, `isFunded()`, `status()`,
   `fund(bytes)`, `release(escrowId,recipient,bytes)`, `create(bytes,…)`. So the bridge + TS target only the
   INTERSECTION api (getAmount, fund(uint256,uint256), redeem) which exists on BOTH the deployed build and the
   current source — so the fork test (deploys current-source Escrow, a superset) still validates it. We deploy
   ONLY TimeLockResolver + X402EscrowReceiver; NOT a new Escrow.
5. **Plugins** = RSS condition resolvers (`IConditionResolver`) + optional underwriter policies.
   v1 = ONE resolver per purchase, chosen from a catalog. Canonical interface = the 3-method
   `@reineira-os/shared` one. reineira-code's copy (2-method) must gain `getConditionFee`.
6. **Plugin storage / connection:** manifests are STANDARDIZED JSON published as static files in the
   Portal repo (`platform-web-portal-app`, e.g. `public/registry/v1/index.json`). App READS them
   (runtime fetch + bundled snapshot fallback). NO separate backend; Vercel-only infra. On-chain
   ERC-165 `supportsInterface` is the bindability check (full ResolverRegistry deferred). One home per
   manifest (App reads, never copies → no dupes). Publishing = curated PR into the registry format (we publish).
7. **HOST = extend `x402-rss/apps/demo`** (Next.js 16; already has x402 loop, /api/resource, /api/run,
   3-zone Settlement Theater UI). Agents run SERVER-SIDE → per-agent owner = a server-held ECDSA key
   (passkey can't sign during unattended runs). Persistence = local file JSON (`.agent-store.json`).
8. **Run model:** Next app on localhost:3000 → REAL Arbitrum Sepolia + REAL ZeroDev v3 bundler/paymaster
   (no anvil fork for the demo path). Facilitator runs as a separate local process on :4021 and is the
   relayer (msg.sender) that calls `receiver.settle` (NOT the Kernel — USDC requires msg.sender==to==receiver).
   ZeroDev paymaster sponsors: (1) one-time Kernel deploy per agent, (2) the withdraw/sweep UserOp.

## VERIFIED ON-CHAIN (Arbitrum Sepolia)

- USDC `0x75faf…AA4d` (impl `0xfbb8ee011af0f15ee171e79c0688d05a58f7f566`) exposes BOTH `(v,r,s)` and
  `bytes` overloads of transfer/receiveWithAuthorization → ERC-1271 capable (SignatureChecker).
- Fork test: a contract (ERC-1271) signer is accepted by USDC's bytes overload; wrong-key reverts.
- LIVE: a real ZeroDev Kernel (`0x31dC5576B215e793aB5b9d0F34C49Df11ef8e943`, v3.1/EP0.7) signed USDC's
  ReceiveWithAuthorization via the SDK (86-byte ERC-7739 sig); `kernel.isValidSignature` → `0x1626ba7e`.
- ZeroDev creds: projectId `866d15a6-e621-4e6a-b796-634611f34211`; bundler+paymaster
  `https://rpc.zerodev.app/api/v3/866d15a6-e621-4e6a-b796-634611f34211/chain/421614`.

## REAL ADDRESS MAP (from packages/*/deployments/arbitrumSepolia.json — IGNORE root CLAUDE.md table)

- Canonical USDC (external): `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`
- ConfidentialUSDC: `0x42E47f9bA89712C317f60A72C81A610A2b68c48a` (FHE; not for x402)
- ConfidentialEscrow: `0xbe1eEB78504B71beEE1b33D3E3D367A2F9a549A6` (FHE)
- **plain Escrow (REUSE): `0xa125db70c1f17E395AfFa30b32e1e4A94aF3A81c`** (paymentToken = canonical USDC; legacy api — see decision 4)
- plain CCTPV2EscrowReceiver: `0xD4cb6F1B679C3b16AE02aAdc66e172142EAAC5a2` (their cross-chain receiver; not our x402 one)
- ConfidentialCoverageManager: `0x40A3A53d54D25cF079Bc9C2033224159d4EA3A67`; ConfidentialPolicyRegistry: `0x962A6c7Be4fC765B0E8B601ab4BB210938660190`
- trustedForwarder: `0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25`
- (source: SDK `packages/sdk/src/constants/addresses.ts` + `docs/reference/deployed-contracts.md`)
- TimeLockResolver / X402EscrowReceiver: NOT YET DEPLOYED (we deploy ONLY these two; reuse the plain Escrow above).
- DEPLOYER/SELLER/FACILITATOR EOA (user-provided testnet key): `0x213CE2FBc6e263203275f3e95547b68c4ea0E952` (0 ETH as of 06-10 — funding pending)
- Default agent Kernel (env wallet, faucet USDC here): `0x1AF0295410813f21DCCD60D3b161cF4356ec2b51`

## BUILD ORDER (status)

- [x] **M1 Bridge contracts + fork test** (DONE 2026-06-09). In `platform-web3-protocol/packages/escrow`:
  - [x] `contracts/plugins/TimeLockResolver.sol` (canonical 3-method, getConditionFee=(0,0)).
  - [x] `contracts/receivers/X402EscrowReceiver.sol` + `contracts/interfaces/receivers/IX402EscrowReceiver.sol`
        (initialize(owner,usdc,escrow); approve(escrow,max); settle(escrowId, abi.encode(PaymentAuthorization))
        → nonce-bind check, value==budget, pull via USDC.receiveWithAuthorization(bytes), escrow.fund;
        deriveNonce helper). PaymentAuthorization = {from,value,validAfter,validBefore,nonce,salt,signature}.
  - [x] `packages/shared/contracts/interfaces/external/IEIP3009.sol` (receive/transferWithAuthorization bytes overloads).
  - [x] `test/integration/X402EscrowReceiver.fork.t.sol` — 8/8 PASSED on real Sepolia fork (ERC-1271 signer →
        real USDC receiveWithAuthorization(bytes) → escrow.fund in ONE tx; release gated by TimeLock; negatives:
        unbound nonce, amount mismatch, wrong signer, replay, unknown escrow, non-owner release).
        All 142 pre-existing package tests still pass.
  - Test cmd: `forge test --match-path 'test/integration/X402EscrowReceiver.fork.t.sol'` (forks; no user funds).
  - NOTE: monorepo deps must be installed first (`npx -y pnpm install` at platform-web3-protocol root).
  - **BIGGEST RISK RETIRED**: the one-tx composition is proven against the real forked USDC.
- [x] **M0 Interface reconciliation** (DONE 2026-06-09): added `getConditionFee` to reineira-code
      `IConditionResolver` + TimelockResolver + ReclaimResolver + ChainlinkConditionBase (virtual default)
      + CLAUDE.md interface snippet. interfaceId now matches canonical. 35/35 tests pass (forge).
- [x] **M2 Deploy to Sepolia** (DONE LIVE 2026-06-10): deployed TimeLockResolver
      `0xC7a3a5Cf38fc85c44a29f6DE9e0F69Bc68f002DB` + X402EscrowReceiver
      `0x02C1BD55CdaD5a251C8eF0242ebcA6c179DA80c2` (reused plain Escrow `0xa125db…A81c`). Addresses in
      `apps/demo/.env.local`. Verified: receiver.usdc/escrow correct, allowance=max, read-only create-with-resolver
      against the deployed escrow returns next id (condition path compatible).
- [x] **LIVE E2E PASSED 2026-06-10** (`apps/demo/scripts/e2e-escrow.mts`, run via `npx tsx`): real ZeroDev Kernel
      `0x1AF0…2b51` (deployed sponsored) signed escrow-bound ReceiveWithAuthorization → facilitator settleExact
      (ERC-1271 verify + receiver.settle) funded escrow #35 on a real tx → agent 2.00→1.90 USDC → after 30s
      TimeLock, seller redeem → 18.00→18.10 USDC. Settle tx 0xf487e945…, redeem tx 0xb3a4c165…. Exactly 0.10
      moved (no protocol fee on this escrow). **BIGGEST RISK fully retired on mainnet-equivalent real chain.**
      NOTE: env-loading — run e2e as `.mts` (pkg exports ESM-only); demo (Next.js) auto-loads `.env.local`.
- [x] **M3 agentWallet.ts** (DONE 2026-06-09): `apps/demo/lib/agentWallet.ts` — createAgentWallet(ownerKey)
      → {address, ownerAddress, signer (ClientEvmSigner via kernel.signTypedData ERC-7739), isDeployed,
      deployIfNeeded (sponsored no-op UserOp), usdcBalance, sweepUsdc (sponsored)}. Deps added to demo:
      @zerodev/sdk ^5.5.10, @zerodev/ecdsa-validator ^5.4.9. Typecheck passes.
- [x] **M4 Core Path B** (DONE 2026-06-09): dual-mode `exact` scheme keyed off `requirements.extra.escrow`
      ({escrowId, salt, receiver, escrow} = X402EscrowExtra in shared). New `core/src/exact/escrow.ts`
      (getEscrowExtra, deriveEscrowNonce=keccak(abi.encode(uint256,bytes32)), encodePaymentAuthorization).
      client.ts: escrow mode → signs ReceiveWithAuthorization with bound nonce. verify.ts: ERC-1271-aware
      isSignatureValid (ecrecover → fallback isValidSignature(digest,sig)==0x1626ba7e) + receiver/nonce
      binding checks (new errors ErrEscrowNonceMismatch/ReceiverMismatch). settle.ts: escrow mode →
      receiver.settle(escrowId, encodedAuth); legacy EOA transferWithAuthorization path untouched.
      shared/abis.ts: +x402EscrowReceiverAbi, +paymentAuthorizationAbiParameters, +timeLockResolverAbi,
      escrowAbi extended (create/release/getOwner/getAmount/getPaidAmount/getConditionResolver/total/EscrowCreated).
      All 54 pre-existing core tests pass; full workspace builds. NOTE: pnpm-workspace.yaml allowBuilds fixed.
- [~] **M5 Walking skeleton** (SERVER WIRING DONE 2026-06-09; needs M2 deploy + env to run live):
  - [x] `apps/demo/lib/sellerEscrow.ts` — getSellerEscrowConfig (env: ESCROW_ADDRESS, X402_RECEIVER_ADDRESS,
        TIMELOCK_RESOLVER_ADDRESS, SELLER_PRIVATE_KEY, ESCROW_DEADLINE_SECONDS=900), createEscrowForSale
        (simulate→write create(seller, amount, timelock, abi.encode(deadline)) → escrowId), validateIssuedEscrow
        (on-chain owner/amount/resolver check vs client-tampered accepted), isEscrowFunded.
  - [x] `/api/resource`: 402 issuance creates a REAL escrow per probe and embeds extra.escrow {escrowId,salt,
        receiver,escrow}+escrowDeadline, payTo=receiver; on payment validates issued escrow on-chain BEFORE verify
        (anti-substitution). Falls back to legacy direct-pay when escrow env unset.
  - [x] `/api/run`: AGENT_PRIVATE_KEY → ZeroDev Kernel signer (deployIfNeeded sponsored, narrated in SSE);
        falls back to BUYER_PRIVATE_KEY EOA. Escrow-aware theater narration.
  - [x] Core unit tests: test/escrow.test.ts — 14 tests (nonce vector cross-checked vs cast keccak/abi-encode,
        client RWA binding, verify EOA+1271+tamper, settle encoding vs decodeAbiParameters, legacy path). 68/68 pass.
  - [ ] LIVE RUN: blocked on M2 (deploy) + .env.local keys.
- [x] **M6 Persistence + ledger** (DONE 2026-06-09): `lib/agentStore.ts` (.agent-store.json, gitignored;
      atomic tmp+rename writes; AgentRecord{id,name,prePrompt,pluginIds,ownerPrivateKey,address,ledger};
      toPublicAgent redacts the key + totals spend). recordSpend wired into /api/run after settle.
- [x] **M7 Multi-agent CRUD + plugin catalog** (DONE 2026-06-09): /api/agents GET/POST (create generates
      owner key + computes counterfactual Kernel address — VERIFIED LIVE, no funds needed);
      /api/plugins; `lib/pluginCatalog.ts` (PORTAL_REGISTRY_URL fetch w/ 3s timeout → bundled snapshot
      fallback; manifest format standardized: id/kind/interface/resolverData/addresses/status);
      `app/components/AgentsPanel.tsx` (select/create/pre-prompt/plugin picker/ledger table/withdraw) +
      CSS; /api/run?agentId= uses the agent's key + prePrompt.
- [x] **M8 Withdraw + release** (DONE 2026-06-09): /api/agents/[id]/withdraw (sponsored sweepUsdc to `to`);
      /api/release (checks timelock deadlineOf, then seller release(escrowId, seller, "")); deal card shows
      Escrow #id + countdown + Release button (SSE kind:"escrow" event carries escrowId+deadline).
- [x] **Smoke tested locally (no keys needed)**: next dev boots; / renders; /api/plugins serves; POST
      /api/agents created "Market Scout" with real Kernel address 0x96007aDe…f118; 402 legacy fallback OK.
- [x] Production `next build` passes; demo typecheck clean; .env.example documents all new vars.

## BLOCKERS — NEEDED FROM USER (only at M2+; M0/M1 need nothing)

1. A funded Arbitrum Sepolia EOA private key → `FACILITATOR_PRIVATE_KEY` (relayer/msg.sender for settle; needs a little ETH).
2. A deployer key with Sepolia ETH to run the deploy ONCE (can be the same key).
3. Testnet USDC faucetted to each agent Kernel's address before its first pay (paymaster sponsors gas, not the USDC value).
4. A seller/owner address (can equal the facilitator EOA for the spike).

## RUNBOOK — live run once a funded key exists (ONE key can play deployer+facilitator+seller)

```bash
# 1. Deploy (once). From platform-web3-protocol/packages/escrow:
export PATH="$HOME/.foundry/bin:$PATH"
PRIVATE_KEY=0x<funded-key> forge script script/DeployX402.s.sol \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc --broadcast
# -> prints Escrow / TimeLockResolver / X402EscrowReceiver addresses

# 2. x402-rss/apps/demo/.env.local:
#   ANTHROPIC_API_KEY=...
#   ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
#   ESCROW_ADDRESS=<from deploy>  X402_RECEIVER_ADDRESS=<from deploy>  TIMELOCK_RESOLVER_ADDRESS=<from deploy>
#   SELLER_PRIVATE_KEY=0x<funded-key>   ESCROW_DEADLINE_SECONDS=120   (short for demo)
#   FACILITATOR_URL=http://localhost:4021
# x402-rss/packages/facilitator/.env (or env):
#   FACILITATOR_PRIVATE_KEY=0x<funded-key>  ARBITRUM_SEPOLIA_RPC_URL=...

# 3. Run (two processes from x402-rss):
pnpm --filter @reineira-os/x402-facilitator run start   # :4021
pnpm --filter @reineira-os/x402-rss-demo run dev        # :3000

# 4. In the app: create an agent -> copy its Kernel address -> faucet testnet USDC to it
#    (https://faucet.circle.com, Arbitrum Sepolia) -> select agent -> Run deal.
#    After countdown: Release to seller. Ledger shows spend; Withdraw sweeps the rest (sponsored).
```

## DESIGN SYSTEM — official @reineira-os/ui adopted (2026-06-10)

Vendored the Portal's official design system `@reineira-os/ui` (from
`platform-web-portal-app/packages/reineira-ui`) into the demo at `apps/demo/ui/` (tokens.css + all
components + the dragon logo `public/logos/reineira-logo.png`); added `lucide-react`. Integration:
- `app/globals.css`: replaced the local `:root` token block with `@import "../ui/tokens.css"` + a small
  compat-alias `:root` bridging legacy Settlement-Theater names (`--radius-*`, `--success/-warning/-error*`,
  `--shadow-blue-glow`, `--card-bg`, `--steel-18`) to canonical tokens. Theater CSS untouched.
- `app/layout.tsx`: `<html class="dark">` (canonical default is light; theater is dark), Inter + JetBrains
  Mono via Google Fonts, ReineiraOS metadata/branding.
- `app/page.tsx`: real `Wordmark` (dragon logo) in topbar + `HonestyRail` (TESTNET·Arbitrum Sepolia·Fhenix
  CoFHE) + branded `SiteFooter` (Portal/Protocol columns, risk notice, GitHub social).
- `AgentsPanel`: token-based (no more ad-hoc hsl); plugin chips use `MaturityStatusBadge` (live/spec) + `Icon`.
- Verified: prod `next build` ✓, typecheck ✓, dev boots, `/`→200, logo 200, markers present (class="dark",
  brand-logo, Fhenix CoFHE, Plugin registry, Inter/JetBrains fonts), /api/plugins serves.
- NOTE: `apps/demo/ui/` is a VENDORED SNAPSHOT of `@reineira-os/ui` (cross-repo; not a live workspace link) —
  re-sync from the Portal package if its tokens/components change.

## UI RESTRUCTURE — multi-page IA (Privara-referenced, 2026-06-10)

Replaced the cramped single-page inline AgentsPanel with a proper multi-page app (Privara's
information architecture as reference: list → detail + dedicated create flow):
- `app/layout.tsx` → app shell: sticky `TopNav` (Wordmark + Agents/Portal/Docs, active state) +
  `HonestyRail` + `SiteFooter`.
- `app/page.tsx` → **Dashboard**: agent cards (name, wallet, live USDC balance, spent, plugin count,
  pre-prompt) + "New agent" CTA + empty/loading states.
- `app/agents/new/page.tsx` → **Create wizard**: 3 steps (Identity → Plugins → Review) with progress
  dots, Back/Continue, plugin cards (description + MaturityStatusBadge + tags), review summary → creates
  agent + Kernel wallet → redirects to workspace.
- `app/agents/[id]/page.tsx` → **Workspace**: agent header (name, copy-address, balance, prompt, stats),
  the `SettlementTheater` (extracted to `components/SettlementTheater.tsx`, scoped to agentId), spend
  ledger table, withdraw, + a faucet hint when balance is 0.
- Data: the env wallet is now materialized as a real "Default agent" (id `env`) via
  `agentStore.ensureDefaultAgent`, so list/detail/run/withdraw treat it uniformly. New
  `GET /api/agents/[id]`; `/api/agents` now returns live USDC balances.
- Verified LIVE: build ✓, all routes 200, `/api/run?agentId=env` → escrow #37 settled on-chain, ledger
  recorded the spend (0.10 USDC), balance updated 1.8→1.7.

## IMPROVEMENT ROADMAP (in progress, 2026-06-10) — user picked ALL directions

Showcase-polish pass. User-selected scope (all four) + two follow-ups (deadline, insurance). Order:

- [x] **Deadline picker** (DONE+verified): TimeLock deadline is now per-agent configurable (was hardcoded
      `ESCROW_DEADLINE_SECONDS=90`). `AgentRecord.deadlineSeconds`; wizard shows a "Release after" control
      (1/5/15 min/1h/custom) DIRECTLY UNDER the TimeLock card; threaded agent → `/api/run?…` →
      `/api/resource?deadlineSeconds=` → `createEscrowForSale(override)`. Verified: 60→63s, 900→906s windows.
- [x] **UI fixes** (DONE): deadline block moved under TimeLock card (was orphaned at list bottom); theater
      columns equalized to `1fr 1fr 1fr` + aligned to container (was `1fr 1.4fr 1fr`, max-width 1440 mismatch).
- [x] **Russian text removed**: deleted the smoke-test "Market Scout" agent (Cyrillic pre-prompt) from
      `.agent-store.json`; sources были clean. App is English-only.
- [ ] **Insurance = 2nd plugin category + attach** (chosen depth; research DONE). Plain insurance IS deployed:
      plainCoverageManager `0x3fcD1896…9D22`, plainPolicyRegistry `0xAf23b860…AB95`, plainInsurancePool
      `0xCd05D0B8…3C33`, plainPoolFactory `0xA2D78bfa…E772`. Key facts from research:
      `purchaseCoverage(holder,pool,policy,escrowId,coverageAmount,coverageExpiry,policyData,riskProof)` —
      permissionless for open pools (holder==msgSender); **NO premium pulled at purchase** (stamps an
      underwriter fee bps on the escrow via `setUnderwriterFee`, paid only on redeem); DeliveryPolicy.evaluateRisk
      returns 0 → free coverage. `dispute(coverageId,proof)` → policy.judge → pool.payClaim → forward to holder
      (needs pool liquidity). Caveats to handle: (a) escrow must have `coverageManager` set to plainCoverageManager
      (owner-gated by 0xa2293 — VERIFY or deploy our own pool+policy via plainPoolFactory where we're creator);
      (b) DeliveryPolicy.judge reads DeliveryDeadlineResolver.isBreached, but our escrows use TimeLock (no
      isBreached) → payout path stays "testnet-incomplete" and we LABEL it honestly. Plan: add "Underwriter
      policy / Coverage" as a 2nd plugin kind in catalog+wizard; real on-chain attach via a `/api/coverage`
      route; show two-sided plugin model. DeliveryPolicy + DeliveryDeadlineResolver NOT pre-deployed (deploy if needed).
- [ ] **Cinematic Settlement Theater**: visualize Buyer→Escrow→Provider money flow, escrow as a vault holding
      funds, TimeLock countdown gauge; use the UNUSED design-system motion (beat-pulse/bind-ring/reveal-up/
      soft-pulse). Elevate WITHIN the Reineira brand (no font/palette swap — keep @reineira-os/ui consistency).
- [ ] **Plugin showcase depth**: surface plugin params (PropertyCard) + resolver interface + a code snippet
      (CodeBlock) — currently 5/10 vendored ui components UNUSED. Make plugins teach builders, not just toggle.
- [ ] **Close the loop: fund + analytics + ZeroDev passkey login**:
      - Fund flow after create (copy Kernel address → faucet link → refresh balance).
      - Spend analytics (chart by agent/plugin/time), withdraw/release polish.
      - **ZeroDev passkey login (QUEUED here, per user 2026-06-10)** — OPTIONAL "Connect with passkey" layer
        (NOT a hard gate, to keep local testing frictionless). When connected: user's smart account = default
        withdraw target + agent scoping. Agents STAY server-side ECDSA (headless signing unaffected) — login is
        a separate trust domain (browser passkey) and does not change agent wallets. Use @zerodev passkey/webauthn validator.
- [ ] **Design polish pass**: micro-interactions/hover, light/dark toggle (tokens are theme-aware — showcase
      it), loading skeletons, toasts instead of inline notices, mobile responsiveness.

## DEFERRED (to stay runnable)

Vercel deploy (local-only v1; file store), key encryption-at-rest, BudgetVault (on-chain budget) + sole-escrow-creator,
on-chain ResolverRegistry, insurance/dispute/buyer-refund economics, multiple resolvers per purchase, ERC-6492,
FHE/confidential escrow, Path A productionization.

## ADVERSARIAL REVIEW (2026-06-09/10, multi-agent workflow)

4-dimension review (solidity / protocol / server / wiring) → 2 refuters per finding. Server + parts of
protocol/wiring hit the session token limit, but the Solidity pass completed and surfaced ONE real bug:

- **[FIXED] TimeLockResolver griefing DoS (high).** `onConditionSet` was permissionless and keyed only by
  `escrowId`. Attacker reads `escrow.total()`=N, pre-calls `timeLock.onConditionSet(N, …)`; seller's later
  `escrow.create(…,timeLock,…)` reverts `AlreadyConfigured(N)`, rolling back `_nextId++` → `_nextId` stuck at
  N forever → permanent DoS of escrow creation. **Fix:** namespace resolver state by `msg.sender` (the calling
  Escrow) — `mapping(address=>mapping(uint256=>uint64)) deadlineOf`. All three resolver methods are always
  invoked BY the Escrow, so this is transparent and also lets one resolver serve multiple escrows. Regression
  test `test_timelock_attackerPreRegistrationDoesNotBlockCreate` added (fork suite now 9/9). Shared
  `timeLockResolverAbi.deadlineOf` is now `(address escrow, uint256 id)`; `/api/release` updated; core 68/68.
- NOTE (not blocking, out of demo path): reineira-code's example `TimelockResolver.sol` has the same
  griefable pattern (`mapping(uint256=>Config)`). It's the builder sandbox example, not the runtime path;
  recommend applying the same msg.sender-namespacing there for showcase quality before promoting it.

## BIGGEST RISK

The live USDC value-transfer through the bridge in ONE tx (receiver internally calls USDC.receiveWithAuthorization(bytes)
as msg.sender==to, then escrow.fund pulls via approval). M1's fork test must reproduce this EXACT composition
(deployed/funded signer + nonce binding) before trusting the wired app at M5.

## ═══ SESSION HANDOFF (2026-06-10, terminal redesign + utility pivot) ═══

RESUME HERE. App is LIVE and working: deploy done, full on-chain loop proven, dev running.

### Running state (verify on resume)
- demo: `cd x402-rss/apps/demo && pnpm run dev` (Next.js, :3000). Reads `apps/demo/.env.local` (has ANTHROPIC key, AGENT/SELLER/FACILITATOR keys, ESCROW/RECEIVER/TIMELOCK addrs, ESCROW_DEADLINE_SECONDS=90).
- facilitator: started w/ inline env on :4021 — `FACILITATOR_PORT=4021 ARBITRUM_SEPOLIA_RPC_URL=... FACILITATOR_PRIVATE_KEY=0x0efd3edc… npx tsx packages/facilitator/src/server.ts`. NEEDED for runs.
- forge tests: `export PATH="$HOME/.foundry/bin:$PATH"` then in platform-web3-protocol/packages/escrow.
- Deployed (Arb Sepolia): plain Escrow REUSED `0xa125db70c1f17E395AfFa30b32e1e4A94aF3A81c` (legacy API: create/fund(uint256,uint256)/redeem/getAmount, NO budget/isFunded/release(bytes)); TimeLockResolver `0xC7a3a5Cf38fc85c44a29f6DE9e0F69Bc68f002DB`; X402EscrowReceiver `0x02C1BD55CdaD5a251C8eF0242ebcA6c179DA80c2`. USDC `0x75faf…AA4d`. Deployer/seller/facilitator EOA `0x213CE2FBc6e263203275f3e95547b68c4ea0E952` (funded ~1 ETH / ~18 USDC). Default agent Kernel `0x1AF0295410813f21DCCD60D3b161cF4356ec2b51` (~1.35 USDC).

### UI is now TERMINAL-CENTRIC (3 routes: / dashboard, /agents/new wizard, /agents/[id] workspace)
- Global chrome: `app/components/AppChrome.tsx` (Wordmark + nav + HonestyRail — rail trimmed to just "TESTNET·Arbitrum Sepolia"+Telegram, NO false FHE claim). `app/layout.tsx` wraps with chrome + SiteFooter, html.dark, Inter+JetBrains via Google Fonts.
- Workspace `app/agents/[id]/page.tsx`: full-height `.ws`; slim header (avatar gradient from addr + name + Default badge + copy-addr + chips deadline/plugins + BIG balance + **Fund** btn [copies addr+opens faucet.circle.com] + **Delete** btn [obvious text, non-default only]); renders `<SettlementTheater agent onSettled={load}/>`.
- `app/components/SettlementTheater.tsx` (the hero): compact settlement **pipe** (Agent→Escrow→Seller nodes, animated rail spark ONLY while paying/releasing — `--done` solid after; escrow segment shows price+TimeLock bar "seller redeems · Ns"/Release btn; resource `<select>` "buys ▼" + Run deal) + **Claude-style terminal** (traffic-light dots, `agent@reineira · settlement session`, Console/Ledger tabs; session lines: `❯` cmd header, `//` thinking, `▸` actions, **x402 payment tool-block** with from/to/value + stepper 402→signed→settled→paid+tx, `·` provider events, green `✓ market read` result; live `$` prompt shows "settled · funds held · seller can redeem in Ns" → "release now" → "released ✓"). CSS all in `app/globals.css` (imports `../ui/tokens.css`; legacy-alias :root; many appended blocks incl .pay*, .pipe*, .term*, .cl*, .ws*).
- Resources CONFIGURABLE (our escrow catalog only — user dropped external/direct x402): `lib/resources.ts` (3: eth-report 0.10, gas-snapshot 0.05, premium-feed 0.25; each has task). `GET /api/resources`. `/api/resource?resourceId=&deadlineSeconds=` resource-driven price+desc+escrow. `/api/run?agentId=&resourceId=` uses resource.task as agent goal, threads resourceId. VERIFIED.
- Agent store `lib/agentStore.ts`: AgentRecord now has `deadlineSeconds`; `ensureDefaultAgent` materializes env wallet as id "env"; `deleteAgent` (blocks "env"); `usdcBalanceOf`. `GET/POST /api/agents`, `GET/DELETE /api/agents/[id]`, `/api/agents/[id]/withdraw`.
- Wizard `app/agents/new/page.tsx`: 3 steps (Identity → Plugins[+TimeLock deadline picker presets/custom UNDER the TimeLock card] → Review). Deadline threaded per-agent.

### USER FEEDBACK/DECISIONS THIS SESSION (honor these)
- Priority: **REAL UTILITY > theater/spectacle.** Keep brand = @reineira-os/ui (don't swap fonts/palette).
- Resource config: **our escrow resources only** (no external/direct x402 for now).
- ZeroDev passkey LOGIN: queued as OPTIONAL "Connect" (part of fund-loop), NOT a hard gate; agents stay server-side ECDSA.
- FHE: we use NONE (plain mode); fixed the honesty-rail that falsely claimed Fhenix CoFHE.
- Release is done by SELLER (owner) via /api/release→redeem, only after TimeLock; demo simplification (button in buyer app).
- Fixed this session: instant delivery→paced (provider "preparing…"→delivers); "idle"→"ready"/"—"; rail spark running after release→stops; broken .pay tool-block CSS; header redesign; delete obvious.

### NEXT WORK — user picked ALL of these (build order TBD, recommend Purchases first):
1. **Purchases view (what was bought + escrow)** [TOP] — store the delivered artifact in the ledger (SpendRecord needs `resourceName` + `artifact`/result + escrow release status); a "Purchases" view per agent: what bought, data received, price, time, escrow status (held/releasable/released — check on-chain or store), Release per purchase + BATCH release matured. Covers "see what acquired" + "take traded sums".
2. **Spend analytics** — breakdown by resource/time, cross-agent totals (spent / in-escrow / deals). Original goal "анализ трат".
3. **Insurance (queued)** — 2nd plugin category (underwriter policy) + real attach via plainCoverageManager `0x3fcD1896…9D22` (research done above: purchaseCoverage(holder,pool,policy,escrowId,amount,expiry,policyData,riskProof); NO premium pulled; payout testnet-incomplete → label honestly). DeliveryPolicy/DeliveryDeadlineResolver in x402-rss/packages/contracts (not pre-deployed).
4. **Quality-of-life** — balance auto-refresh/poll after Fund; per-agent budget cap; "buy N resources" multi-run; better empty states/onboarding.
5. **EDIT AGENTS (new ask 2026-06-10)** — let user edit an existing agent (name, pre-prompt, plugins, deadline). Add `PATCH /api/agents/[id]` + an edit UI (reuse wizard or an inline edit on the workspace header). Note: changing the wallet is NOT possible (key is fixed); edit only metadata/config.

### ScA gotchas / notes
- Each run = real on-chain tx (creates escrow + settles) costing ~0.05–0.10 USDC from the agent Kernel + gas from deployer EOA. Don't loop runs needlessly.
- e2e script (no UI/Anthropic needed): `apps/demo/scripts/e2e-escrow.mts` via `npx tsx`.
- pnpm: workspace uses corepack `npx -y pnpm`. Build demo: `npx -y pnpm --filter @reineira-os/x402-rss-demo run build`.

---

## ═══ SESSION HANDOFF (2026-06-10b — Model B passkey treasury + showcase prep) ═══

Everything in the "NEXT WORK" list above (items 1,2,4,5) is **DONE**. Item 3 (Insurance) is the **only remaining big feature** and is to be built on a fresh context. Plus a passkey-owned treasury + session keys (variant 3 / "Model B") was designed, built, and verified on-chain this session.

### RUNNING STATE
- Demo dev server: `apps/demo` on **:3000** (Next 16, `next dev`) — UP.
- Facilitator on **:4021** — UP (settlements verified: escrow #57/#58/#67/#70 etc.).
- Anthropic key in `.env.local` (agent loop = Claude Haiku `claude-haiku-4-5-20251001`).

### WHAT'S DONE (this session)
- **Purchases + Audit log**: each SpendRecord stores `resourceName/result/artifact/deadline/released/releaseTx` + a **`transcript`** (agent reasoning, captured server-side in `/api/run`). Purchases tab (in the terminal) lists buys with status (held/releasable/released), per-row + batch **Release**, and an **Audit log** modal (`PurchaseDetail`) showing the reasoning transcript + delivered data + tx links.
- **Analytics page** (`/analytics`): **ECharts** (`echarts` + `echarts-for-react`, SVG renderer via `app/components/EChart.tsx`) — area (spend over time), gradient bars (by resource / by agent), doughnut (escrow status) + filters (agent + 24h/7d/30d/All) + KPI row. Home page is clean (no analytics band).
- **Global app shell**: left sidebar (`Sidebar.tsx` + `Shell.tsx`, collapsible, persisted `pa-nav`) with Agents/Analytics/Plugins/Resources + Docs/Portal + theme toggle (`ThemeToggle.tsx`, `pa-theme`) + testnet badge. Replaced the old topnav (`AppChrome.tsx` deleted).
- **Catalog pages**: `/plugins` (registry incl. coming-soon `delivery-coverage-policy` underwriter-policy), `/resources` (eth-report/gas-snapshot/premium-feed, escrow-mode).
- **Edit agents**: `PATCH /api/agents/[id]` + `/agents/[id]/edit` (single form). **Delete moved into the Edit page** as a "danger zone" (workspace sidebar only has "Edit agent"; Default agent can't be deleted).
- **Palette calmed**: blue = action/links, green = settled/release; addresses/notices neutralized.
- **Settlement pipe** = status-only now (Agent → 🔒Escrow(center) → Seller, connectors fill symmetrically). **Resource selector + ▷ Run deal moved into the terminal footer** (`.term__foot`, shell-style input pinned at bottom of Console tab). `.ws` is full-width (no centered max-width dead-zone).

### MODEL B — passkey treasury + session keys (variant 3) — BUILT & VERIFIED ON-CHAIN
The user's chosen money model: **one passkey-owned treasury; agents have NO wallets and pay from the treasury via a server-held ECDSA session key, within an authorized budget.**
- **Client** `lib/passkeyTreasury.ts`: passkey create/login (`@zerodev/passkey-validator` 5.6.0, **`PasskeyValidatorContractVersion.V0_0_3_PATCHED`** — NOT V0_0_2, see gotcha), persisted in **localStorage** (`pa-treasury-serialized/-address/-session`). `grantSessionKey(budgetAtomic)` builds a permission validator (`@zerodev/permissions` 5.6.3: `addressToEmptyAccount`+`toECDSASigner`, `toSudoPolicy`, `toPermissionValidator`) and **`serializePermissionAccount`** (the ONE fingerprint, off-chain), POSTs the approval. `getSessionStatus`, `storedTreasuryAddress`, `forgetTreasury`.
- **Server** `lib/sessionStore.ts` (`.session-store.json`): per-treasury `{ sessionKeyPrivateKey, sessionKeyAddress, approval, budgetAtomic, spentAtomic }`. `getOrCreateSessionKey`, `saveGrant`, `addSpent`, `getSession`.
- **Server** `lib/sessionWallet.ts`: `getTreasurySigner(treasury)` → `ClientEvmSigner` from `deserializePermissionAccount` (session key signs EIP-3009/ERC-1271 as the treasury). **`ensureTreasuryDeployed(treasury)`** → if account has no code, send ONE sponsored session-key no-op userOp to deploy+enable (fixes the counterfactual-treasury bug). `distributeViaSession` (legacy, see cleanup).
- **API**: `app/api/session/{route(GET status),key,grant,distribute}/route.ts`; `app/api/zerodev/route.ts` (same-origin RPC proxy, mostly legacy).
- **`/api/run`**: accepts `&treasury=`; if present → pays from treasury (calls `ensureTreasuryDeployed` then `getTreasurySigner`), app-enforced budget gate + `addSpent`; else falls back to per-agent wallet. Prompt reworked for **persona + budget awareness** (item "1+3"): pre-prompt = the agent's persona/voice/decision driver; remaining treasury budget injected; agent genuinely decides buy/skip ("Agent decided not to buy" path).
- **UI**: `TreasuryPanel.tsx` (home) = Create-with-passkey / Use-existing / **Reset** + Fund + **Authorize budget** (grant, "Change budget", shows remaining/spent). Agent sidebar = **Funding** card ("pays from treasury · X left", no per-agent Fund/Withdraw). `SettlementTheater` passes `storedTreasuryAddress()` to the run; pipe agent node says "via passkey treasury".

### ZeroDev FACTS / GOTCHAS (critical — cost hours to find)
- **"Unauthorized: wapk"** = ZeroDev gateway **blocks UNPATCHED passkey validators** (V0_0_1/V0_0_2) after a Sept-2025 passkey vuln disclosure (GitHub issue **zerodevapp/sdk#235**). FIX = use **`V0_0_3_PATCHED`**. ECDSA ops are unaffected (sponsored fine).
- **`invalid_exact_evm_signature`** = the treasury was **counterfactual (not deployed)** → its EIP-3009 ERC-1271 sig can't verify. Model B has no distribute to deploy it, so we added **`ensureTreasuryDeployed`** (auto-activate before first payment). Old V0_0_2 treasuries can't activate (wapk) → user must Reset → recreate on V0_0_3.
- **RPC**: use **v3** `https://rpc.zerodev.app/api/v3/<projectId>/chain/421614` for BOTH bundler + paymaster; paymaster wired via `paymaster: { getPaymasterData: (uo) => zeroDevPaymaster.sponsorUserOperation({ userOperation: uo }) }` (NOT the ERC-7677 `pm_getPaymasterStubData` default — and NOT v2 endpoints, which aren't configured for this project → "ChainId not found"). ZeroDev dashboard has "Sponsor all transactions" ON.
- ZeroDev project id `866d15a6-e621-4e6a-b796-634611f34211` (env `ZERODEV_PROJECT_ID`); passkey server `https://passkeys.zerodev.app/api/v3/<pid>` (RP=localhost, works on localhost:3000). Kernel `KERNEL_V3_1`, EntryPoint `0.7`, sdk 5.5.10, passkey-validator 5.6.0, permissions 5.6.3.

### DEMO STATE (cleaned for colleagues)
- Stores cleaned; backups at `apps/demo/.agent-store.json.bak` + `.session-store.json.bak`.
- **Agents** (all empty ledgers): Default agent (30s), **Momentum Trader** (60s, aggressive), **Risk-Averse Desk** (300s, cautious/may decline), **Gas Optimizer** (60s, frugal). Personas drive visibly different reasoning (verified).
- **Treasury**: passkey-owned, **V0_0_3 working address `0x54165be2dE20FCF71B4c8F0db87c040512777Ea7`** (DEPLOYED, ~17.x USDC, budget 5 USDC, spent reset to 0, granted). Old undeployed V0_0_2 = `0x5C1952C00e3C8b732670441eEcAA27102bFdC098` (do NOT use). NOTE: the treasury the BROWSER uses = whatever is in localStorage; if it's the old/blocked one, **Treasury → Reset → Use existing** re-derives on V0_0_3.
- Demo "wow": run eth-report on Momentum vs Risk-Averse (different read on same data); set budget to 0.05 → Risk-Averse declines premium-feed; Audit log + Release + Analytics.

### NEXT WORK (fresh context) — ITEM 3: INSURANCE (2nd plugin category)
- Make the **underwriter-policy** plugin class real (currently only a coming-soon catalog entry `delivery-coverage-policy`). 
- Research from prior handoff: `plainCoverageManager` **`0x3fcD1896745B2b91b4397e7E762910Fbf7eE9D22`** — `purchaseCoverage(holder,pool,policy,escrowId,amount,expiry,policyData,riskProof)`; **no premium pulled**; **payout testnet-incomplete** → label honestly. `DeliveryPolicy`/`DeliveryDeadlineResolver` in `x402-rss/packages/contracts` are NOT pre-deployed.
- Likely shape: optional "attach coverage" when an agent buys (purchaseCoverage on the escrow), show coverage status in the purchase/audit view, and an honest "payout: testnet-incomplete" note. Verify the deployed manager ABI on-chain first (it drifted before — see escrow legacy-API lesson).

### OPTIONAL CLEANUP (dead code from pre-Model-B)
- `/api/session/distribute` + `distributeViaServer` (Model B pays direct, doesn't distribute to agent wallets).
- per-agent `/api/agents/[id]/withdraw` (agents hold no funds now).
- `apps/demo/scripts/diag-session.mts` + `diag-treasury-pay`-style scripts.
- vestigial per-agent `ownerPrivateKey`/`address` in the store (agents don't pay from them).
- unused CSS: `.pipe__actions/.pipe__resource/.pipe__run`, `.flow__*`, `.agside__delete/.agside__fund/.agside__withdraw`, `.dash-stats*`.

### VERIFY COMMANDS
- typecheck: `cd apps/demo && npm run typecheck`
- live e2e (treasury pays): `curl -sN "http://localhost:3000/api/run?agentId=env&resourceId=eth-report&treasury=0x54165be2dE20FCF71B4c8F0db87c040512777Ea7"`

## ═══ SESSION HANDOFF (2026-06-10c — Insurance (item 3) BUILT + cleanup) ═══

Item 3 (Insurance / underwriter-policy) is CODE-COMPLETE and proven on-chain end-to-end EXCEPT the two
one-time protocol-owner txs, which the user (Vladimir) does TOMORROW with the Deployer key 0xa2293a…
After those 2 txs, coverage purchase + payout go fully live with NO code changes.

> **UPDATE 2026-06-11 — INSURANCE NOW FULLY LIVE.** All 3 owner-setup txs landed:
> (1) `escrow.setInsuranceManager` + (2) `registry.registerPolicy` by Deployer 0xa2293a…;
> (3) `pool.addPolicy(0xc90bd0fc…)` by SELLER 0x213CE2FB… (tx 0x2124bf2560fbbfe3d8ca15b2512f616ab1f71a65c843d2072e59e436a8f33b10).
> `insurance-check.mts check` is all-green: insuranceManager set = true, policy allow-listed = true,
> purchaseCoverage simulation SUCCEEDS. Pool staked 2.00 USDC (capped payout).
> Coverage now records a real coverageId/tx instead of status="pending-setup".
>
> **2026-06-11 — CLAIM/PAYOUT now works (two bugs fixed).** (1) `/api/coverage/claim` route was
> MISSING from git: `.gitignore`'s generic `coverage/` (test reports) also swallowed
> `apps/demo/app/api/coverage/` → the route never committed. Fixed with a `!`-negation; route
> rebuilt (dispute(coverageId) from the treasury via session key → pool pays coverage amount back).
> (2) coverage `expiry` was set to the delivery deadline → ~0s claim window after a breach; now
> `deadline + CLAIM_WINDOW (1h)` so a breached purchase is actually claimable. Proven e2e on
> escrow #93: breach → claim → 0.10 USDC paid pool→treasury (tx 0x07c78217…).

### DEPLOYED THIS SESSION (Arbitrum Sepolia, our SELLER key 0x213CE2FB…)
- DeliveryDeadlineResolver = 0xf1cf91d4c1efb055d648b3d8d73f9c86446cdcc0  (escrow→0xa125db…, verified)
- DeliveryPolicy          = 0xc90bd0fc6515a1152d1776ad19a39b76d8670e1c  (coverageManager→0x3fcD…, ERC165 IUnderwriterPolicy ✓)
- Our InsurancePool (id 12)= 0x3B345841d2bB6eF1Ef2E8E7BD9ce94598dBC6fA6  (underwriter=SELLER, USDC, CM wired, STAKED 2 USDC)
- Live (pre-existing): CoverageManager 0x3fcD1896745B2b91b4397e7E762910Fbf7eE9D22, PolicyRegistry 0xAf23b86086FC6DC74796865be3B3a8bBAd68AB95, PoolFactory 0xA2D78bfaB94B93106c8Da17E6967501D54DfE772
- Env added to apps/demo/.env.local: COVERAGE_MANAGER_ADDRESS, DELIVERY_POLICY_ADDRESS, DELIVERY_DEADLINE_RESOLVER_ADDRESS, COVERAGE_POOL_ADDRESS

### TOMORROW — the only remaining steps (≈3 txs, ~1 min)
1) [Deployer key 0xa2293a…] unblock the escrow + register the policy:
   export PATH="$HOME/.foundry/bin:$PATH"; RPC=https://sepolia-rollup.arbitrum.io/rpc
   cast send 0xa125db70c1f17E395AfFa30b32e1e4A94aF3A81c "setInsuranceManager(address)" 0x3fcD1896745B2b91b4397e7E762910Fbf7eE9D22 --rpc-url $RPC --private-key $DEPLOYER_KEY
   cast send 0xAf23b86086FC6DC74796865be3B3a8bBAd68AB95 "registerPolicy(address)" 0xc90bd0fc6515a1152d1776ad19a39b76d8670e1c --rpc-url $RPC --private-key $DEPLOYER_KEY
2) [our SELLER key, after step 1] allow-list the policy on our pool:
   SK=$(grep -E '^SELLER_PRIVATE_KEY=' apps/demo/.env.local | cut -d= -f2- | tr -d '"' )
   cast send 0x3B345841d2bB6eF1Ef2E8E7BD9ce94598dBC6fA6 "addPolicy(address)" 0xc90bd0fc6515a1152d1776ad19a39b76d8670e1c --rpc-url $RPC --private-key $SK
3) VERIFY: cd apps/demo && npx tsx scripts/insurance-check.mts check
   → expect "insuranceManager set = true", "policy allow-listed = true", and the purchaseCoverage simulation to SUCCEED (no revert).

### HOW THE FEATURE WORKS (all REAL on-chain once the 3 txs land)
- Agent with the `delivery-coverage-policy` plugin → its x402 escrow is created with DeliveryDeadlineResolver
  (attester=SELLER) instead of TimeLock (resolver chosen via &coverage=1; run route gates on agent.pluginIds — FIRST use of pluginIds server-side).
- After settle, /api/run calls the live CoverageManager.purchaseCoverage(holder=treasury, pool, policy, escrowId,
  amount, expiry, abi.encode(resolver, escrowId), "0x") via lib/coverage.ts → real CoveragePurchased event, coverageId, tx.
  Zero premium (DeliveryPolicy.evaluateRisk=0). Failure-isolated: pre-setup it records status="pending-setup" and the purchase is unaffected.
- Release of a covered escrow (/api/release): seller attestDelivery → redeem (happy path). If the deadline passes
  unattested it is a breach → release 409s, and the buyer files a claim.
- Claim (/api/coverage/claim): dispute(coverageId) sent FROM the treasury via its session key (lib/sessionWallet.sendFromTreasury);
  valid breach pays USDC from the pool back to the treasury. Pool is staked with 2 USDC for a real (capped) payout.
- UI (SettlementTheater): coverage badge on purchase rows (insured #id / pending setup / claimed $), "File claim →"
  button when active+releasable, coverage fact + honest note in the audit modal, ☂ coverage line in the transcript.
  /plugins shows delivery-coverage-policy + delivery-deadline-resolver as LIVE.

### TESTED TODAY (without owner txs)
- scripts/insurance-check.mts check: resolver.escrow ✓, policy.coverageManager ✓, readiness=NOT ready (both owner
  blockers visible), purchaseCoverage simulation reverts as expected pre-setup. (proves only blocker = owner setup)
- scripts/insurance-check.mts resolver (live, ownerless): created delivery escrow #79 → attestDelivery → isDelivered=true;
  escrow #80 no-attest → isBreached=true. (resolver leg proven end-to-end)
- GET /api/resource?coverage=1 → escrow uses DeliveryDeadlineResolver; without it → TimeLock. (routing proven)
- Full covered /api/run via treasury 0x54165be2…: escrow #83 (delivery resolver), paid from treasury, coverage recorded
  status="pending-setup" with honest note, data delivered (purchase unaffected). SpendRecord.coverage persisted.
- typecheck green throughout; home/plugins/analytics/agent pages 200.

### IMPORTANT FIX (affects the whole app, not just insurance)
- Arbitrum Sepolia block.timestamp can run AHEAD of wall-clock; short escrow windows were at risk of reverting
  InvalidDeadline on create. createEscrowForSale + attachCoverage now base the deadline/expiry on
  max(local, chain block.timestamp) (sellerEscrow.ts / coverage.ts). This is why a covered create earlier failed and now doesn't.

### CLEANUP DONE THIS SESSION (item 2)
- Deleted dead routes/files: app/api/session/distribute, app/api/zerodev, scripts/diag-session.mts.
- Removed dead fns/exports: distributeViaServer, distributeViaSession, isSessionGranted, dead kernelClient/paymaster +
  ZERODEV_RPC in passkeyTreasury, TreasuryRecord/ensureTreasury/getTreasury in agentStore, erc20Abi.transfer dups.
- CSS: app/globals.css 1540 → 921 lines (−619); removed flow-theater/vault/old-layout/dash-stats/etc. dead families
  (each grep-verified zero TSX refs; dynamic families preserved).

### DEFERRED / DECISIONS (autonomous)
- Per-agent wallet FALLBACK in /api/run (createBuyerSigner branches 2/3) + the withdraw route were KEPT, not removed:
  the env agent Kernel 0x1AF0…2B51 still holds ~6.40 USDC and the auto-mode classifier blocks sweeping to an
  unnamed address. Keeping the fallback + withdraw route preserves fund recovery and headless testing. To finish this:
  Vladimir confirms a sweep destination (suggest SELLER 0x213CE2FB…) → run POST /api/agents/env/withdraw {to} →
  then branches 2/3 + withdraw route + ownerPrivateKey minting can be removed.
- Demo DB has junk agents "ооо"/"ввв" + accumulated ledgers on Default/Momentum/Gas (from post-handoff testing).
  Not auto-cleaned (user's DB). Added a clean demo agent "Insured Buyer" (timelock + delivery-coverage-policy, empty ledger).

### VERIFY COMMANDS
- readiness/sim: cd apps/demo && npx tsx scripts/insurance-check.mts check
- resolver e2e: npx tsx scripts/insurance-check.mts resolver
- covered run:  curl -sN "http://localhost:3000/api/run?agentId=<insured-buyer-id>&resourceId=eth-report&treasury=0x54165be2dE20FCF71B4c8F0db87c040512777Ea7"

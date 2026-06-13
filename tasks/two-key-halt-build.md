# Two-Key Halt / Bonded x402 — build log (DONE, on-chain proven 2026-06-14)

THE single buildathon showcase (user decision 2026-06-13). Bond-into-escrow is a NEW VERB on the
existing x402 settle primitive. Mechanic tagline: "Stake to speak." FHE private flow PARKED as a
future reel (probe said feasible-live for the settle leg).

## Status: built + proven end-to-end, PR pending

- [x] Contracts: `ProtectedVault.sol`, `AlertResolver.sol`, `interfaces/IProtectedVault.sol`.
- [x] Forge tests green (22/22: conformance + vault role-gating + breach flip).
- [x] Deployed to Arb Sepolia + roles granted + vault seeded.
- [x] Server lib `lib/twoKey.ts` — bond over REAL x402 (EIP-3009/facilitator) + choreography.
- [x] `/api/run?mode=twokey[&falseAlarm=1]` env-gated branch (isolated from hero path).
- [x] UI: `TwoKeyTheater.tsx` + `TwoKeyTheater.module.css` + `/two-key` page + Sidebar nav link.
- [x] On-chain proof, BOTH paths, via the real Next endpoint.
- [ ] Feature-branch PR.
- [ ] (eyeball) visual pass of /two-key in the browser.

## Deployed (Arbitrum Sepolia)
- ProtectedVault:  `0x831bD23DF4c2de88C02bcAcEbbd7a4aFeCc97c7d` (PAUSER_ROLE=Guardian, DEMO_ROLE=backend 0x213C)
- AlertResolver:   `0xD7172bC2A297b1cDeC33A2BE4Cbfdeb20Ce5e7FF` (bound to plain Escrow 0xa125db70 + the vault)
- Guardian EOA:    `0xCE26Bcb9bc61F0f4418782B0a7c8A46652BFAd84` (PAUSER_ROLE only — can freeze, cannot move funds)
- Sentinel EOA:    `0xbfE943329Abe533990890883D4dF741d95750daC` (stakes the bond, owns the bond escrow)
- (keys live in apps/demo/.env.local, gitignored)

## Proof (every step a real Arb Sepolia tx, three distinct keys)
VALID path (escrow #102): bond over x402 `0x59fc0227…` → staged drain `0x46235082…` →
Guardian pause `0x27ced879…` → verdict VALID (on-chain read) → Sentinel redeem `0xdeeb3a68…`.
FALSE alarm (escrow #103): bond over x402 `0xc966ed9d…` → Guardian pause `0xa5a0ddc4…` →
verdict FALSE → redeem reverts (bond locked = slash) → Guardian unpause `0xc3503ba6…`.
Standalone proof script: `apps/demo/scripts/twokey-proof.ts` (VALID redeem `0x7a6b89bb…`).

## Honesty ledger
- LIVE: bond stake (EIP-3009/facilitator), Guardian pause, on-chain verdict (AlertResolver), bond settle.
- STAGED (labelled): attacker `demoDrain` tx + the "detection" line.
- MECHANISM/DEFERRED (labelled): bounty pool is hollow; trustless 3-way slash/refund needs a new
  AlertEscrow (~3-5d) — here "slash" == bond locked (redeem reverts on a false alarm), which is honest.

## Run it
1. Facilitator on :4021, Next dev on :3000 (rebuild stale shared→core dist + restart facilitator
   if x402 pays fail invalid_exact_evm_signature — see project_x402_demo_runtime_gotchas).
2. Open http://localhost:3000/two-key → "Run the Two-Key Halt" (toggle "false alarm" for the coda).

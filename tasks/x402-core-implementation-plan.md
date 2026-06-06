# x402 `exact` — Own the Standard (`packages/core`)

Status: DRAFT for review. Not yet branched/implemented.

## Goal

Replace the runtime dependency on `@x402/core` + `@x402/evm` with our own pruned,
EIP-3009-only implementation of the x402 v2 `exact` scheme, **wire-compatible** with
the open x402 standard. Establishes RSS (Reineira Settlement Standard) as an
independent implementation of an open spec — not a wrapper around the Foundation SDK.

## Why

- **Ownership / narrative:** RSS is a standard, not a Coinbase/Foundation-SDK wrapper.
- **Dependency risk:** `@x402/*` is young (v2.14) and the API churned (we already hit
  type-mismatch friction with `toFacilitatorEvmSigner`, needing `as unknown as` casts).
- **Control:** when we later add confidential amounts (FHE) or 4337/session-key
  settlement, we own the scheme and can extend it.
- We **reuse the open x402 spec** (Apache-2.0, x402 Foundation) — we reimplement only
  the code.

## Non-goals (parked)

- Permit2 path, gas-sponsoring extensions (EIP-2612 / ERC-20 approval), ERC-6492
  smart-wallet signatures, `upto` / `batch-settlement` / `auth-capture` schemes, x402 v1.
- ZeroDev session keys / ERC-4337 (parked — buyer is a plain EOA + thin-float).
- Scope is strictly **EOA + EIP-3009 + USDC + Arbitrum Sepolia**.

## Key decisions (please review)

1. **Reimplement from blueprint, not file-copy.** Their npm ships compiled JS only
   (no `.ts`); their GitHub `.ts` is Apache-2.0. We reimplement from the documented
   spec/blueprint and keep `@x402/*` as a **dev-only differential oracle**. Add a
   `NOTICE` crediting x402 Foundation (Apache-2.0) for the derived design.
2. **`transferWithAuthorization`, not `receiveWithAuthorization`.** Matches the x402
   reference → wire-compat. Fix `shared/src/x402.ts` (`method`) — current value
   `receiveWithAuthorization` is a latent interop bug.
3. **Package name `@reineira-os/x402-core`** — sits beside `shared`; the "standard" pkg.
4. **No generic multi-scheme registry.** Exactly one scheme×network — inline the
   exact-evm logic. Keep `verify`/`settle` signatures wire-identical so the facilitator
   app and buyer adapter surfaces don't change.
5. **Monorepo, no repo split.** Clean publishable package; split later only if external
   contributors / separate release cycles appear.

## Target architecture

```
packages/
  core/                NEW — the standard (0 external protocol deps; viem + shared only)
    src/
      types.ts         PaymentRequired, PaymentRequirements, PaymentPayload,
                       VerifyResponse, SettleResponse  (mirror x402 v2 shapes)
      envelope.ts      encode/decode PAYMENT-REQUIRED | PAYMENT-SIGNATURE |
                       PAYMENT-RESPONSE   (base64 + JSON)
      exact/
        client.ts      buildAuthorization + signTypedData(TransferWithAuthorization)
                       -> PaymentPayload
        verify.ts      facilitator verify: recover signer, match fields, time window,
                       nonce-unused, balance
        settle.ts      facilitator settle: USDC.transferWithAuthorization, wait receipt
      index.ts
  shared/              types / addresses / abis   (fix x402.ts `method`)
  x402-rss/            BUYER — uses core/exact/client + envelope (drop @x402/fetch+evm)
  facilitator/         uses core/exact/verify+settle + envelope (drop @x402/core+evm)
  rss/ , contracts/    unchanged
apps/demo              uses core/envelope (drop @x402/core/http)
```

## Wire details (locked from recon — must match byte-for-byte)

- **EIP-712 domain:** `{ name: requirements.extra.name, version: requirements.extra.version,
  chainId, verifyingContract: requirements.asset }`. The 402 challenge supplies USDC
  `name`/`version` via `extra`.
- **Typed data:** `TransferWithAuthorization(from,to,value,validAfter,validBefore,nonce)`.
- **nonce:** 32 random bytes → `0x` + 64 hex.
- **validAfter** = now − 600; **validBefore** = now + `maxTimeoutSeconds`.
- **Payload:** `{ authorization: {from,to,value,validAfter,validBefore,nonce}, signature }`
  — `value`/timestamps as decimal strings, `nonce` hex.
- **verify checks:** scheme/network match; recovered signer == `from`; `to`/`value`/`asset`
  match requirements; `validBefore ≥ now+6`, `validAfter ≤ now`;
  `authorizationState(from,nonce) == false`; `balanceOf(from) ≥ value`.
- **settle:** 65-byte sig → split `v,r,s` → `transferWithAuthorization(...,v,r,s)`;
  `>65` bytes → bytes-signature variant; wait receipt; return
  `{ success, transaction: hash, network, payer: from }`.
- **Headers:** `base64(JSON)`; field names per x402 v2.

## Differential oracle (de-risk)

Keep `@x402/*` as **devDependency only**. Tests assert:

- Our client payload verifies under **their** facilitator verify, and theirs verifies
  under **ours** (cross-accept).
- Our header encode/decode round-trips and **byte-matches** theirs for fixed inputs.
- Our EIP-712 digest == theirs for a fixed message.

Offline-capable (signing + verify are offline; on-chain settle stays env-gated as today).
**After green, remove `@x402/*` from all `package.json`.**

## Migration order

`buyer → facilitator → demo`, each swapped onto `core`, **public surfaces unchanged**,
tests green at each step. Final: drop `@x402/*` runtime deps; add `NOTICE`.

## Done criteria

- New `packages/core` with full test coverage (envelope + exact client + verify; settle
  env-gated).
- Differential tests green vs `@x402` runtime.
- buyer / facilitator / demo migrated; public surfaces unchanged; all existing tests green.
- `@x402/*` absent from runtime deps (dev-only until final removal, then gone).
- `shared/src/x402.ts` `method` fixed to `transferWithAuthorization`.
- Build + typecheck clean across the workspace.
- `NOTICE` attribution (x402 Foundation, Apache-2.0).

## Task breakdown (subagent-driven execution)

1. Scaffold `packages/core` (pkg.json, tsup, vitest, tsconfig; deps: viem, shared).
2. `types.ts` + `envelope.ts` + tests.
3. `exact/client.ts` + offline tests.
4. `exact/verify.ts` + offline tests (mock chain reads).
5. `exact/settle.ts` + env-gated integration test.
6. Differential oracle tests vs `@x402` runtime.
7. Migrate `x402-rss` (buyer) → core; keep `createX402RssFetch` surface.
8. Migrate `facilitator` → core; keep app routes.
9. Migrate `apps/demo` envelope → core.
10. Drop `@x402/*` deps; add `NOTICE`; full green + build.
```

# BUILD SPEC — `packages/core` (`@reineira-os/x402-core`)

Authoritative build/migration spec for A4 (DEV-209). Reimplements x402 v2 `exact`
(EIP-3009-only) so the monorepo drops `@x402/*` runtime deps. Derived from a source-map
of all three consumers + an `@x402` source recon. See also `x402-core-implementation-plan.md`.

## 0. Dependency direction

- `core` depends ONLY on: `viem`, `@reineira-os/x402-rss-shared` (`X402`, `ARBITRUM_SEPOLIA`,
  `SettlementProof`, `erc3009Abi`, `escrowAbi`). Zero `@x402/*` in runtime deps.
- `core` is consumed by: `facilitator`, `x402-rss` (buyer), `apps/demo`.
- **Hard constraint:** all three consumers keep their public surface byte-for-byte; only their
  internal `@x402/*` imports repoint to `core`. Error-message strings + decoded-payload field
  names are load-bearing (tests assert them).

## 1. `core` public API (exact names — drop-in for `@x402`)

Subpath exports the consumers import:

- `@reineira-os/x402-core/types` — `PaymentRequirements`, `PaymentRequired`,
  `ExactEvmAuthorization`, `PaymentPayload`, `VerifyResponse`, `SettleResponse`,
  `SelectPaymentRequirements`.
- `@reineira-os/x402-core/http` — `encodePaymentRequiredHeader`, `decodePaymentRequiredHeader`,
  `decodePaymentSignatureHeader` (returns `{ accepted, payload, x402Version }`),
  `encodePaymentSignatureHeader`. base64(JSON), wire-compatible with x402 v2.
- `@reineira-os/x402-core/exact/client` — `toClientEvmSigner(account, publicClient)`,
  `class ExactEvmScheme` (ctor `(signer)`), `class x402Client` (ctor `(select?)`, `.register(network, scheme)` returns `this`),
  `wrapFetchWithPayment(baseFetch, client)`.
- `@reineira-os/x402-core/exact/verify` — `verifyExact(payload, requirements, { publicClient })`.
- `@reineira-os/x402-core/exact/settle` — `toFacilitatorEvmSigner(walletClient)`,
  `settleExact(payload, requirements, { signer, publicClient })`.
- `@reineira-os/x402-core/facilitator` — `class X402Facilitator` (`verify`, `settle`, `getSupported()`),
  `registerExactEvmScheme(facilitator, { signer, networks })` (networks = `X402.network`).

Load-bearing field names (tests assert): `PaymentPayload.x402Version===2`, `.scheme==="exact"`,
`.network==="eip155:421614"`, `.payload.authorization.{from,to,value,validAfter,validBefore,nonce}`,
`.payload.signature` matches `/^0x[0-9a-fA-F]+$/`. `authorization.to===payTo`, `BigInt(value)===amount`.
`VerifyResponse.{isValid,payer?,invalidReason?}`, `SettleResponse.{success,transaction?,network?,errorReason?}`.

## 2. Migration deltas (import repoint only; call sites unchanged)

**facilitator/src/facilitator.ts:** `@x402/core/facilitator` `x402Facilitator` → `core/facilitator` `X402Facilitator`
(`new X402Facilitator()`); `@x402/evm/exact/facilitator` `registerExactEvmScheme` → `core/facilitator`;
`@x402/evm` `toFacilitatorEvmSigner` → `core/exact/settle`. `app.ts`/`server.ts`/routes/`CreateFacilitatorOptions` unchanged.
`FacilitatorLike = Pick<X402Facilitator,"verify"|"settle">` must still hold. Tests: repoint `@x402/core/types`→`core/types`; fit-check `getSupported()` must contain `eip155:421614`.

**x402-rss/src/fetch.ts:** `@x402/fetch` `{wrapFetchWithPayment, x402Client, SelectPaymentRequirements}` → `core/exact/client`;
`@x402/evm` `{ExactEvmScheme, toClientEvmSigner}` → `core/exact/client`. Validation block + error strings unchanged.
Tests: `encodePaymentRequiredHeader`/`decodePaymentSignatureHeader` from `@x402/core` → `core/http`.

**apps/demo/app/api/resource/route.ts:** `@x402/core/http` `{decodePaymentSignatureHeader, encodePaymentRequiredHeader}` → `core/http`.
`scripts/agent-client.ts` unchanged (uses buyer adapter).

**package.json (all three):** drop `@x402/*`; add `@reineira-os/x402-core: workspace:*`.

## 3. shared fix

`packages/shared/src/x402.ts`: `method: "receiveWithAuthorization"` → `"transferWithAuthorization"`.
Blast radius = NONE at runtime (dead config; grep-confirmed). `core` settles via `transferWithAuthorization` regardless.

## 4. Test strategy

- Keep ALL existing consumer tests green after import-repoint (offline ones in CI; `*.integration.sepolia.test.ts` stay env-gated: `X402_FACILITATOR_INTEGRATION`/`X402_FACILITATOR_SETTLE`/`X402_RSS_INTEGRATION`).
- **Differential oracle (dev-only):** keep `@x402/core`+`@x402/evm`+`@x402/fetch` as **devDependencies of `core` only**. New `packages/core/test/oracle.*.test.ts` proving byte-equality vs `@x402`:
  - `encodePaymentRequiredHeader` byte-equal; `decodePaymentSignatureHeader` shape-equal.
  - `ExactEvmScheme` produces byte-equal authorization + signature for same account+requirement.
  - `verifyExact`/`settleExact` decisions match `@x402` on identical payloads (RPC sub-checks env-gated).
- After green, the oracle is the proof; `@x402/*` later removed entirely.

## 5. Open risks (oracle/adversarial must cover)

1. demo `Parameters<typeof encodePaymentRequiredHeader>[0]` cast — `core` input type must accept demo's object.
2. `amount` string↔bigint boundary (stringification must match for signature recovery).
3. EIP-712 domain exact struct (not in maps — extract from `@x402/evm` dist + oracle).
4. settle MUST call `transferWithAuthorization` (not `receiveWithAuthorization`); pick correct `erc3009Abi` overload (v/r/s for 65-byte EOA sig).
5. `getSupported()` must reflect registered networks (fit-check depends).
6. `x402Client.register` returns `this`; ctor accepts optional `select`.
7. `FacilitatorLike` Pick stays valid (async sigs match).
8. `ClientEvmSigner`/`FacilitatorEvmSigner` adapter interfaces unspecified by maps — define in `core`, pin via oracle.
9. error-string parity (validation lives in consumers; `core` must not throw competing errors earlier).
10. header wire format (key casing/framing) — round-trip + oracle vs `@x402/core/http`.

## 6. Wire blueprint (from `@x402` source recon — authoritative for byte-compat)

- **Headers:** base64(JSON). `payment-required` (PaymentRequired), `payment-signature` (PaymentPayload), `payment-response` (SettleResponse).
- **EIP-712 domain (EIP-3009):** `{ name: requirements.extra.name, version: requirements.extra.version, chainId: parseInt(network.split(":")[1],10), verifyingContract: requirements.asset }`. USDC: name `"USD Coin"`, version `"2"`.
- **Typed data `TransferWithAuthorization`:** `[from address, to address, value uint256, validAfter uint256, validBefore uint256, nonce bytes32]`.
- **nonce:** `toHex(randomBytes(32))` → `0x`+64 hex.
- **validAfter** = `floor(now/1000) - 600`; **validBefore** = `floor(now/1000) + maxTimeoutSeconds`.
- **message:** `{ from: signer.address, to: payTo, value: BigInt(amount), validAfter, validBefore, nonce }`.
- **payload:** `{ x402Version:2, scheme:"exact", network, payload:{ authorization:{from,to,value:amount(string),validAfter:(string),validBefore:(string),nonce}, signature } }`.
- **verify:** recover signer == `from`; scheme/network match; `to==payTo`; `value==amount`; asset match; `validBefore >= now+6`; `validAfter <= now`; `authorizationState(from,nonce)==false`; `balanceOf(from) >= value`. → `{ isValid, payer: from, invalidReason? }`.
- **settle:** 65-byte sig → split `v,r,s` → `erc3009Abi.transferWithAuthorization(from,to,value,validAfter,validBefore,nonce,v,r,s)`; wait receipt; → `{ success:true, transaction: hash, network, payer: from }`. (>65-byte sig → bytes-signature overload; EOA = 65 bytes.)

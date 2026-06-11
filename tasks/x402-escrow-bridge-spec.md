# MINI-SPEC — `X402EscrowReceiver.settle` (the x402 → escrow bridge)

Status: DRAFT for review. This is the linchpin of the "real" variant: an x402 (EIP-3009)
payment lands as `escrow.fund()` into a specific escrow, so the resource provider is paid
**only when the escrow's condition (plugin) is met** — and the agent's money is refundable
via a mandatory auto-release. Out of scope here: the per-agent BudgetVault, the app/UI,
and the insurance/dispute economics. This spec covers ONLY the bridge contract + the few
things that gate it.

Grounded in verified source:
- `platform-web3-protocol/packages/escrow/contracts/core/Escrow.sol` — plaintext `IERC20` escrow.
  `create(owner,amount,resolver,resolverData)` (permissionless), `fund(id,bytes)` /
  `fund(id,uint256)` (permissionless, `safeTransferFrom(sender→escrow)`), `redeem`/`release`
  require `owner==msg.sender` + condition met. No refund/cancel path exists.
- `platform-web3-protocol/packages/escrow/contracts/receivers/CCTPV2EscrowReceiver.sol` — the
  proven receiver template: `approve(escrow, max)` at init; in `settle`: pull funds, check
  `escrow.exists`, `escrow.fund(id, abi.encode(amount))`, emit.
- `x402-rss/packages/contracts/contracts/X402EscrowReceiver.sol` — current stub (`revert NotImplemented`).
- `x402-rss/packages/core/src/exact/settle.ts` — today settles via `transferWithAuthorization(v,r,s)`.

## 0. Settlement-scheme change (what moves)

Today: 402 `payTo` = seller EOA; facilitator calls `USDC.transferWithAuthorization` → USDC goes
straight to the seller. **No escrow.**

Bridge: introduce an x402 scheme variant ("exact-escrow") where:
- 402 challenge `payTo` = **the `X402EscrowReceiver` contract address** (not the seller).
- payer signs **`receiveWithAuthorization`** (recipient-pull), `to = receiver`.
- the facilitator's settle step calls **`receiver.settle(...)`** instead of `USDC.transferWithAuthorization`.
- the receiver pulls USDC to itself, then `escrow.fund(escrowId, value)`. Seller gets paid later
  via `escrow.release/redeem` once the condition resolver returns true.

`receiveWithAuthorization` is chosen over `transferWithAuthorization` because USDC enforces
`msg.sender == to`, so only the receiver contract can consume the authorization — this binds
the pull to our contract and blocks a third party from replaying it elsewhere.

## 0b. Payer: EOA vs smart account — CORRECTION (changes the wallet model)

Earlier claim "the payer must be an EOA; an SCA literally cannot pay x402" was TOO STRONG.
Refined truth, by layer:

- **USDC token (FiatTokenV2_2): SUPPORTS smart-contract-wallet payers.** v2.2 added ERC-1271 via
  the `bytes signature` overloads of `transferWithAuthorization`/`receiveWithAuthorization`, which
  route through OZ `SignatureChecker` (ECDSA-recover for EOAs; falls back to ERC-1271
  `isValidSignature` for contracts). This is exactly what lets Coinbase / Base Smart Wallet pay
  USDC gaslessly. The legacy `(v,r,s)` overload is ECDSA-only (EOA-only).
- **x402 protocol (Coinbase "exact" spec):** standardizes EIP-3009 as the 65-byte EOA path; routes
  smart accounts via UserOperations (ERC-4337, opt-in) or ERC-7710 delegation. So "x402 + smart
  wallet" = USDC-1271 in practice + UserOp/7710 in the spec (native 4337 support is an open RFC).
- **THIS repo today: EOA-only by construction** — `verify.ts` does local ECDSA recover; `settle.ts`
  calls the `(v,r,s)` overload. Same class of bug as x402-rs issue #26 (fed a 1271 sig to the ECDSA
  path → "FiatTokenV2: invalid signature").

**Two real payer models:**
- **Path A — EOA pays, SCA = vault:** no facilitator change; ships now; agent's payer is a small EOA
  topped up from the SCA vault. (This spec's original assumption.)
- **Path B — SCA pays directly** (matches "agent pays from its own ZeroDev wallet"): extend the
  facilitator — `settle` uses the `bytes` overload of `receiveWithAuthorization`; verify validates
  on-chain (SignatureChecker / `isValidSignature`) instead of local `ecrecover`; handle ERC-6492 or
  require the Kernel deployed before first pay. Depends on: deployed USDC = v2.2 with the `bytes`
  overload AND the ZeroDev Kernel implementing ERC-1271 over the EIP-712 digest.

The bridge (§1) is unchanged either way (receiver pulls via `receiveWithAuthorization`); only the
signature kind + which overload `settle` calls differs. nonce-binds-escrowId (§2) still applies to both.

### VERIFIED on-chain (2026-06-09, Arbitrum Sepolia)

- **USDC `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` (impl `0xfbb8ee011af0f15ee171e79c0688d05a58f7f566`)
  exposes BOTH overloads** — confirmed by selector presence in the implementation bytecode:
  `transferWithAuthorization(...,bytes)` `0xcf092995`, `receiveWithAuthorization(...,bytes)` `0x88b7ab63`,
  `permit(...,bytes)` `0x9fd5a6cf`, plus the legacy `(v,r,s)` ones. The `bytes` overloads route through
  OpenZeppelin `SignatureChecker` ⇒ accept ERC-1271. **Path B is supported at the token level.** ✅
- **Kernel as the 1271 signer (the remaining risk):** Kernel implements ERC-1271 but applies **ERC-7739**
  defensive rehashing (nested EIP-712, anti cross-account replay). So Path B requires, concretely:
  1. produce the signature via the **ERC-7739 typed-data flow** (ZeroDev SDK / viem `erc7739/signTypedData`),
     NOT a raw owner-key ECDSA sig over USDC's digest — else `isValidSignature` rejects it;
  2. the agent's **Kernel must be DEPLOYED** before its first payment — USDC's `SignatureChecker` is plain
     ERC-1271, not ERC-6492-aware, so it can't validate a counterfactual (undeployed) account;
  3. our facilitator calls the **`bytes`-overload** of `receiveWithAuthorization` and DROPS local
     `ecrecover` in verify (let USDC's `SignatureChecker` validate, or pre-check via `isValidSignature`).
  Architecturally sound (this is how Coinbase/Base Smart Wallet pays USDC).
- **Token-side proof DONE (fork test, 2026-06-09):** on an Arbitrum Sepolia fork, a minimal ERC-1271
  contract account was the `from` on `receiveWithAuthorization(...,bytes)` — USDC validated via
  `SignatureChecker`/ERC-1271 and moved the funds; a wrong-key signature reverted (negative control).
  So **USDC honoring a contract signer on the bytes overload is now empirically confirmed**, not just
  inferred. (Test: `/tmp/u1271/test/Usdc1271.t.sol` — should be landed as an env-gated integration test.)
- **Kernel-specific proof DONE (live, 2026-06-09, Arbitrum Sepolia):** deployed a real ZeroDev Kernel
  (`0x31dC5576B215e793aB5b9d0F34C49Df11ef8e943`, kernel v3.1 / EntryPoint 0.7, deploy tx
  `0xec0329f67d2b21c288c3f0ac0fdc40ee90c54fcd0129cacf230eba8ad39f3a5b`, paymaster-sponsored). Signed
  USDC's `ReceiveWithAuthorization` typed data via the ZeroDev SDK (`account.signTypedData`) — produced
  an **86-byte ERC-7739-wrapped** signature — and `kernel.isValidSignature(USDC_digest, sig)` returned
  **`0x1626ba7e`** (ERC-1271 magic), the exact call USDC's `SignatureChecker` makes on the bytes
  overload. viem `verifyTypedData` also returned `true`. (Script: `/tmp/zk/verify.mjs`.)

**CONCLUSION: Path B is validated end-to-end at the signature layer.** A deployed ZeroDev Kernel can be
the EIP-3009 `from` and pay x402 via `receiveWithAuthorization(...,bytes)`, with USDC honoring its
ERC-1271 signature. The only unexercised step is moving real USDC on-chain (needs the Kernel funded with
testnet USDC) — a formality given §2a proved USDC moves funds once `isValidSignature` returns the magic.
Build the bridge for Path B: `settle` calls the **bytes** overload; `verify` drops local `ecrecover`
(let USDC's `SignatureChecker` validate); ensure the agent Kernel is deployed before its first pay.

## 1. Contract shape

Align with the protocol receiver pattern (UUPS, `TestnetCoreBase`), not the current plain stub.

```solidity
contract X402EscrowReceiver is IX402EscrowReceiver, TestnetCoreBase {
    IERC20  public usdc;
    IEscrow public escrow;

    function initialize(address owner_, address usdc_, address escrow_) external initializer {
        // zero-address checks
        __TestnetCoreBase_init(owner_);
        usdc = IERC20(usdc_);
        escrow = IEscrow(escrow_);
        IERC20(usdc_).approve(escrow_, type(uint256).max); // so escrow.fund can pull from us
    }

    struct Eip3009Auth {
        address from;        // payer EOA (codeless; see wallet model)
        uint256 value;       // == escrow.getAmount(escrowId)
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;       // BINDS the escrowId — see §2
        uint8 v; bytes32 r; bytes32 s;
    }

    function settle(uint256 escrowId, Eip3009Auth calldata a) external nonReentrant returns (uint256 funded);
}
```

`settle` algorithm (mirrors CCTPV2EscrowReceiver, swapping CCTP `receiveMessage` for EIP-3009):

```
1. require escrow.exists(escrowId)                              // known escrow
2. require a.nonce == _bind(escrowId)                           // payment is tied to THIS escrow (§2)
3. require a.value == escrow.getAmount(escrowId)                // exact amount, no under/over-fund
4. balBefore = usdc.balanceOf(this)
5. usdc.receiveWithAuthorization(a.from, address(this), a.value,
                                 a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s)
6. funded = usdc.balanceOf(this) - balBefore                   // fee-on-transfer-safe delta
7. require funded == a.value
8. escrow.fund(escrowId, abi.encode(funded))                   // escrow pulls from our approval
9. emit EscrowSettled(escrowId, a.from, funded)
```

The facilitator's existing verify checks (signature recovers to `from`, time window, nonce
unused on USDC, balance) stay as a pre-flight; settle re-validates on-chain via the USDC call
itself (it reverts on a bad/expired/replayed authorization).

## 2. escrowId binding — the security knot (THE thing to confirm)

`escrowId` is passed in calldata but is NOT part of what EIP-3009 signs `(from,to,value,validAfter,validBefore,nonce)`.
Without binding, a griefer could front-run `settle` with the agent's broadcast authorization but a
**different** `escrowId`, sending the agent's USDC into an escrow the griefer controls.

**Decision (leading): commit the escrowId into the `nonce`.** The payer derives
`nonce = keccak256(abi.encode(escrowId, salt))` and signs the authorization with it; `settle`
requires `a.nonce == keccak256(abi.encode(escrowId, salt))` (salt passed alongside, or salt = 0
for the spike). Because the signature covers `nonce`, the authorization is now cryptographically
bound to exactly one `escrowId` — no custom EIP-712 domain needed, standard USDC `receiveWithAuthorization`
still works. nonce uniqueness holds (escrowId is unique; salt adds entropy if a retry is needed).

Alternatives considered (weaker, listed for the record):
- (B) restrict `settle` to a trusted relayer/facilitator key — trust-based, not cryptographic.
- (C) make `BudgetVault` the sole escrow creator AND settle caller, check `escrow.getCaller(escrowId)==vault`
  — good defense-in-depth for v2, layered ON TOP of (A), not instead of it.

**Recommendation:** ship (A) now; add (C) when the vault exists.

## 3. Who creates the escrow

`escrow.create(owner, amount, resolver, resolverData)` happens **before** payment, NOT inside settle:
- **Spike/v1:** a script (or the resource server) creates the escrow with
  `owner = seller`, `amount = price`, `resolver = TimeLockResolver`, `resolverData = abi.encode(deadline)`.
- **v2:** the per-agent `BudgetVault` is the sole creator (so `owner`/`caller` can't be spoofed),
  and is the only entity allowed to `settle` on the agent's behalf.

The 402 challenge must carry the `escrowId` (and salt) to the payer so it can sign the bound nonce —
add them to the x402 `resource`/`extra` fields.

> Owner/refund economics note (OUT OF SCOPE, but flagged): plain `Escrow` releases to ONE owner when
> the condition is true and has no native buyer-refund. "Pay seller on delivery, else refund buyer"
> needs either owner=buyer + inverse condition, a two-escrow setup, or the insurance layer. Decide
> separately; the bridge does not depend on it.

## 4. Must-fix BEFORE this compiles end-to-end: interface reconciliation

Verified divergence — three copies of `IConditionResolver`:
- `reineira-code/contracts/interfaces/IConditionResolver.sol` — **2 methods** (`isConditionMet`, `onConditionSet`).
- `x402-rss/packages/rss/.../IConditionResolver.sol` — **3 methods** (+ `getConditionFee`).
- `platform-web3-protocol/packages/shared/.../plugins/IConditionResolver.sol` — **3 methods** (canonical).

Their ERC-165 `interfaceId`s differ, so a resolver authored in `reineira-code` (e.g. `TimeLockResolver`)
will FAIL a registry/`supportsInterface` check against the protocol. **Action:** adopt
`@reineira-os/shared` as the single canonical interface; x402-rss imports it; reineira-code resolvers
add `getConditionFee` (return `(0, address(0))` when no fee) and import shared. CI guard that fails if
the files diverge. This must land before any on-chain plugin binding.

## 5. Mandatory anti-stranding default

`Escrow` has no cancel/expire: an unmet condition locks funds forever. So **every** escrow opened by
the bridge path must carry a liveness guarantee. Default = `TimeLockResolver` (exists in reineira-code,
releases after `deadline`), `deadline = now + maxTimeoutSeconds (+ margin)`. The agent-side plugin
binding must reject any resolver config without a timeout/auto-release for the resource type.

## 6. Proof: the one end-to-end test (Arbitrum Sepolia or fork)

```
create escrow (owner=seller, amount=price, resolver=TimeLockResolver, deadline)
  → agent signs receiveWithAuthorization(to=receiver, value=price, nonce=bind(escrowId))
  → receiver.settle(escrowId, auth)                      // pulls USDC, funds escrow
  → assert escrow.isFunded(escrowId) == true
  → warp past deadline → seller release/redeem succeeds  // condition met → seller paid
  → (negative) before deadline, release reverts ConditionNotMet
```

Green here = the real path holds end-to-end; app/vault/analytics build on top.

## 7. Open sub-questions to confirm before coding

1. ✅ ANSWERED: USDC `0x75faf…AA4d` exposes the `bytes` overloads (1271-capable) — Path B is open at
   the token level. Remaining for Path B: the live Kernel round-trip (see "VERIFIED on-chain" above) —
   confirm a 7739-signed `receiveWithAuthorization(bytes)` from a DEPLOYED Kernel lands on this USDC.
2. Canonical escrow for plaintext USDC = plain `Escrow.sol` (not FHE `ConfidentialEscrow`)? (Assumed yes.)
3. Is `nonce = keccak256(escrowId, salt)` acceptable, or do we want salt threaded through the 402 challenge?
4. Owner model for the demo: owner = seller (pay-on-delivery) for the spike — agreed?

import type { Address, Hex } from "viem";

export type EscrowId = bigint;

export type CoverageId = bigint;

export interface SettlementProof {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  signature: Hex;
}

export type DealStatus =
  | "open"
  | "funded"
  | "delivered"
  | "released"
  | "disputed"
  | "refunded";

export interface X402EscrowExtra {
  escrowId: string;
  salt: Hex;
  receiver: Address;
  escrow: Address;
}

import { encodeAbiParameters, getAddress, keccak256, type Hex } from "viem";
import { paymentAuthorizationAbiParameters } from "@reineira-os/x402-rss-shared";
import type { ExactEvmAuthorization, PaymentRequirements } from "../types.js";

export type EscrowPaymentExtra = {
  escrowId: string;
  salt: Hex;
  receiver: `0x${string}`;
  escrow: `0x${string}`;
};

export const ReceiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function getEscrowExtra(
  requirements: PaymentRequirements,
): EscrowPaymentExtra | null {
  const raw = requirements.extra?.escrow as Record<string, unknown> | undefined;
  if (!raw) {
    return null;
  }
  if (
    typeof raw.escrowId !== "string" ||
    typeof raw.salt !== "string" ||
    typeof raw.receiver !== "string" ||
    typeof raw.escrow !== "string"
  ) {
    throw new Error("Malformed escrow extra in payment requirements");
  }
  return {
    escrowId: raw.escrowId,
    salt: raw.salt as Hex,
    receiver: getAddress(raw.receiver),
    escrow: getAddress(raw.escrow),
  };
}

export function deriveEscrowNonce(escrowId: bigint, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "bytes32" }],
      [escrowId, salt],
    ),
  );
}

export function encodePaymentAuthorization(
  auth: ExactEvmAuthorization,
  salt: Hex,
  signature: Hex,
): Hex {
  return encodeAbiParameters(paymentAuthorizationAbiParameters, [
    {
      from: getAddress(auth.from),
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
      salt,
      signature,
    },
  ]);
}

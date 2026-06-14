import { getAddress, parseSignature, type Hex } from "viem";
import { erc3009Abi, x402EscrowReceiverAbi } from "@reineira-os/x402-rss-shared";
import type {
  ExactEvmAuthorization,
  ExactEvmPayload,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "../types.js";
import { verifyExact, type ReadContractClient } from "./verify.js";
import { encodePaymentAuthorization, getEscrowExtra } from "./escrow.js";
import { ErrInvalidScheme, ErrTransactionFailed } from "./errors.js";

export type FacilitatorEvmSigner = {
  getAddresses(): readonly `0x${string}`[];
  readContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  writeContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<`0x${string}`>;
  waitForTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: string }>;
};

type FacilitatorClientLike = Omit<FacilitatorEvmSigner, "getAddresses"> & {
  address: `0x${string}`;
};

export function toFacilitatorEvmSigner(client: FacilitatorClientLike): FacilitatorEvmSigner {
  return {
    ...client,
    getAddresses: () => [client.address],
  };
}

export interface SettleExactContext {
  signer: FacilitatorEvmSigner;
  publicClient: ReadContractClient;
}

function extractExactPayload(payload: PaymentPayload): ExactEvmPayload {
  return payload.payload as unknown as ExactEvmPayload;
}

function splitSignature(signature: Hex): { v: bigint; r: Hex; s: Hex } {
  const parsed = parseSignature(signature);
  const r = parsed.r;
  const s = parsed.s;
  let v: bigint;
  if (parsed.v !== undefined) {
    v = parsed.v;
  } else if (parsed.yParity !== undefined) {
    v = BigInt(parsed.yParity) + 27n;
  } else {
    throw new Error("Unable to derive recovery id from signature");
  }
  if (v < 27n) {
    v += 27n;
  }
  return { v, r, s };
}

export async function settleExact(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  ctx: SettleExactContext,
): Promise<SettleResponse> {
  const exact = extractExactPayload(payload);
  const auth = exact?.authorization as ExactEvmAuthorization | undefined;
  if (!auth || !payload.accepted || typeof exact.signature !== "string") {
    return {
      success: false,
      errorReason: ErrInvalidScheme,
      network: payload.accepted?.network,
    };
  }
  const payer = auth.from;
  const network = payload.accepted.network;

  try {
    const verified = await verifyExact(payload, requirements, {
      publicClient: ctx.publicClient,
    });
    if (!verified.isValid) {
      return {
        success: false,
        errorReason: verified.invalidReason ?? ErrInvalidScheme,
        network,
        payer,
      };
    }

    const erc20Address = getAddress(requirements.asset);
    const escrowExtra = getEscrowExtra(requirements);

    let hash: `0x${string}`;
    if (escrowExtra) {
      hash = await ctx.signer.writeContract({
        address: escrowExtra.receiver,
        abi: x402EscrowReceiverAbi as readonly unknown[],
        functionName: "settle",
        args: [
          BigInt(escrowExtra.escrowId),
          encodePaymentAuthorization(auth, escrowExtra.salt, exact.signature as Hex),
        ],
      });
    } else {
      const signature = exact.signature as Hex;
      // A 65-byte ECDSA sig (130 hex chars) uses the v/r/s overload; anything else is a
      // contract-wallet (ERC-1271) signature that verifyExact accepted via isValidSignature,
      // so route it to transferWithAuthorization's single-bytes overload instead of splitting.
      const isEcdsa = signature.replace(/^0x/, "").length === 130;
      hash = await ctx.signer.writeContract({
        address: erc20Address,
        abi: erc3009Abi as readonly unknown[],
        functionName: "transferWithAuthorization",
        args: isEcdsa
          ? (() => {
              const { v, r, s } = splitSignature(signature);
              return [
                getAddress(auth.from),
                getAddress(auth.to),
                BigInt(auth.value),
                BigInt(auth.validAfter),
                BigInt(auth.validBefore),
                auth.nonce,
                Number(v),
                r,
                s,
              ];
            })()
          : [
              getAddress(auth.from),
              getAddress(auth.to),
              BigInt(auth.value),
              BigInt(auth.validAfter),
              BigInt(auth.validBefore),
              auth.nonce,
              signature,
            ],
      });
    }

    const receipt = await ctx.signer.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return {
        success: false,
        errorReason: ErrTransactionFailed,
        transaction: hash,
        network,
        payer,
      };
    }

    return { success: true, transaction: hash, network, payer };
  } catch (error) {
    return {
      success: false,
      errorReason: error instanceof Error ? error.message : ErrTransactionFailed,
      network,
      payer,
    };
  }
}

import {
  getAddress,
  parseSignature,
  type Hex,
} from "viem";
import { erc3009Abi } from "@reineira-os/x402-rss-shared";
import type {
  ExactEvmAuthorization,
  ExactEvmPayload,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "../types.js";
import { verifyExact, type ReadContractClient } from "./verify.js";
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
  waitForTransactionReceipt(args: {
    hash: `0x${string}`;
  }): Promise<{ status: string }>;
};

type FacilitatorClientLike = Omit<FacilitatorEvmSigner, "getAddresses"> & {
  address: `0x${string}`;
};

export function toFacilitatorEvmSigner(
  client: FacilitatorClientLike,
): FacilitatorEvmSigner {
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
  const auth: ExactEvmAuthorization = exact.authorization;
  const payer = auth.from;
  const network = payload.accepted.network;

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

  try {
    const { v, r, s } = splitSignature(exact.signature as Hex);
    const hash = await ctx.signer.writeContract({
      address: erc20Address,
      abi: erc3009Abi as readonly unknown[],
      functionName: "transferWithAuthorization",
      args: [
        getAddress(auth.from),
        getAddress(auth.to),
        BigInt(auth.value),
        BigInt(auth.validAfter),
        BigInt(auth.validBefore),
        auth.nonce,
        Number(v),
        r,
        s,
      ],
    });

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

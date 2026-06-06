import {
  getAddress,
  recoverTypedDataAddress,
  type Hex,
} from "viem";
import { erc3009Abi } from "@reineira-os/x402-rss-shared";
import type {
  ExactEvmAuthorization,
  ExactEvmPayload,
  Network,
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
} from "../types.js";
import {
  ErrAssetMismatch,
  ErrEip3009InsufficientBalance,
  ErrEip3009NonceAlreadyUsed,
  ErrInvalidAuthorizationValue,
  ErrInvalidScheme,
  ErrInvalidSignature,
  ErrMissingEip712Domain,
  ErrNetworkMismatch,
  ErrRecipientMismatch,
  ErrValidAfterInFuture,
  ErrValidBeforeExpired,
} from "./errors.js";

export interface ReadContractClient {
  readContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

export interface VerifyExactContext {
  publicClient: ReadContractClient;
}

const TransferWithAuthorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function getEvmChainId(network: Network): number {
  const chainId = parseInt(network.split(":")[1] ?? "", 10);
  if (Number.isNaN(chainId)) {
    throw new Error(`Invalid CAIP-2 chain ID: ${network}`);
  }
  return chainId;
}

function extractExactPayload(payload: PaymentPayload): ExactEvmPayload {
  return payload.payload as unknown as ExactEvmPayload;
}

export async function verifyExact(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  ctx: VerifyExactContext,
): Promise<VerifyResponse> {
  const exact = extractExactPayload(payload);
  const auth: ExactEvmAuthorization = exact.authorization;
  const payer = auth.from;

  if (payload.accepted.scheme !== "exact" || requirements.scheme !== "exact") {
    return { isValid: false, invalidReason: ErrInvalidScheme, payer };
  }

  if (!requirements.extra?.name || !requirements.extra?.version) {
    return { isValid: false, invalidReason: ErrMissingEip712Domain, payer };
  }

  if (payload.accepted.network !== requirements.network) {
    return { isValid: false, invalidReason: ErrNetworkMismatch, payer };
  }

  const erc20Address = getAddress(requirements.asset);
  if (getAddress(payload.accepted.asset) !== erc20Address) {
    return { isValid: false, invalidReason: ErrAssetMismatch, payer };
  }

  let recovered: `0x${string}`;
  try {
    recovered = await recoverTypedDataAddress({
      domain: {
        name: requirements.extra.name as string,
        version: requirements.extra.version as string,
        chainId: getEvmChainId(requirements.network),
        verifyingContract: erc20Address,
      },
      types: TransferWithAuthorizationTypes,
      primaryType: "TransferWithAuthorization",
      message: {
        from: getAddress(auth.from),
        to: getAddress(auth.to),
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce,
      },
      signature: exact.signature as Hex,
    });
  } catch {
    return { isValid: false, invalidReason: ErrInvalidSignature, payer };
  }

  if (getAddress(recovered) !== getAddress(auth.from)) {
    return { isValid: false, invalidReason: ErrInvalidSignature, payer };
  }

  if (getAddress(auth.to) !== getAddress(requirements.payTo)) {
    return { isValid: false, invalidReason: ErrRecipientMismatch, payer };
  }

  const now = Math.floor(Date.now() / 1000);
  if (BigInt(auth.validBefore) < BigInt(now + 6)) {
    return { isValid: false, invalidReason: ErrValidBeforeExpired, payer };
  }
  if (BigInt(auth.validAfter) > BigInt(now)) {
    return { isValid: false, invalidReason: ErrValidAfterInFuture, payer };
  }

  if (BigInt(auth.value) !== BigInt(requirements.amount)) {
    return { isValid: false, invalidReason: ErrInvalidAuthorizationValue, payer };
  }

  const nonceUsed = (await ctx.publicClient.readContract({
    address: erc20Address,
    abi: erc3009Abi,
    functionName: "authorizationState",
    args: [getAddress(auth.from), auth.nonce],
  })) as boolean;
  if (nonceUsed) {
    return { isValid: false, invalidReason: ErrEip3009NonceAlreadyUsed, payer };
  }

  const balance = (await ctx.publicClient.readContract({
    address: erc20Address,
    abi: erc3009Abi,
    functionName: "balanceOf",
    args: [getAddress(auth.from)],
  })) as bigint;
  if (balance < BigInt(auth.value)) {
    return { isValid: false, invalidReason: ErrEip3009InsufficientBalance, payer };
  }

  return { isValid: true, payer };
}

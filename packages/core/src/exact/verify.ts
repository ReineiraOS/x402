import {
  getAddress,
  hashTypedData,
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
  deriveEscrowNonce,
  getEscrowExtra,
  ReceiveWithAuthorizationTypes,
  type EscrowPaymentExtra,
} from "./escrow.js";
import {
  ErrAssetMismatch,
  ErrEip3009InsufficientBalance,
  ErrEip3009NonceAlreadyUsed,
  ErrEscrowNonceMismatch,
  ErrEscrowReceiverMismatch,
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

const erc1271Abi = [
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes4" }],
  },
] as const;

const ERC1271_MAGIC = "0x1626ba7e";

async function isSignatureValid(
  publicClient: ReadContractClient,
  signer: `0x${string}`,
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  },
  signature: Hex,
): Promise<boolean> {
  try {
    const recovered = await recoverTypedDataAddress({
      ...(typedData as Parameters<typeof recoverTypedDataAddress>[0]),
      signature,
    });
    if (getAddress(recovered) === getAddress(signer)) {
      return true;
    }
  } catch {
    // not a plain ECDSA signature for this signer — fall through to ERC-1271
  }

  try {
    const digest = hashTypedData(
      typedData as Parameters<typeof hashTypedData>[0],
    );
    const magic = (await publicClient.readContract({
      address: signer,
      abi: erc1271Abi,
      functionName: "isValidSignature",
      args: [digest, signature],
    })) as Hex;
    return magic?.toLowerCase().startsWith(ERC1271_MAGIC) ?? false;
  } catch {
    return false;
  }
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

  let escrowExtra: EscrowPaymentExtra | null;
  try {
    escrowExtra = getEscrowExtra(requirements);
  } catch {
    return { isValid: false, invalidReason: ErrEscrowReceiverMismatch, payer };
  }

  const typedData = {
    domain: {
      name: requirements.extra.name as string,
      version: requirements.extra.version as string,
      chainId: getEvmChainId(requirements.network),
      verifyingContract: erc20Address,
    },
    types: escrowExtra
      ? ReceiveWithAuthorizationTypes
      : TransferWithAuthorizationTypes,
    primaryType: escrowExtra
      ? "ReceiveWithAuthorization"
      : "TransferWithAuthorization",
    message: {
      from: getAddress(auth.from),
      to: getAddress(auth.to),
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
  };

  const signatureValid = await isSignatureValid(
    ctx.publicClient,
    getAddress(auth.from),
    typedData as unknown as Parameters<typeof isSignatureValid>[2],
    exact.signature as Hex,
  );
  if (!signatureValid) {
    return { isValid: false, invalidReason: ErrInvalidSignature, payer };
  }

  if (getAddress(auth.to) !== getAddress(requirements.payTo)) {
    return { isValid: false, invalidReason: ErrRecipientMismatch, payer };
  }

  if (escrowExtra) {
    if (getAddress(requirements.payTo) !== escrowExtra.receiver) {
      return { isValid: false, invalidReason: ErrEscrowReceiverMismatch, payer };
    }
    const expectedNonce = deriveEscrowNonce(
      BigInt(escrowExtra.escrowId),
      escrowExtra.salt,
    );
    if (auth.nonce.toLowerCase() !== expectedNonce.toLowerCase()) {
      return { isValid: false, invalidReason: ErrEscrowNonceMismatch, payer };
    }
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

import { getAddress, toHex, type LocalAccount, type PublicClient } from "viem";
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "../http.js";
import type {
  ExactEvmAuthorization,
  ExactEvmPayload,
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SelectPaymentRequirements,
} from "../types.js";
import {
  deriveEscrowNonce,
  getEscrowExtra,
  ReceiveWithAuthorizationTypes,
} from "./escrow.js";

export type ClientEvmSigner = {
  readonly address: `0x${string}`;
  signTypedData(message: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
  readContract?(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
};

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

function createNonce(): `0x${string}` {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj) {
    throw new Error("Crypto API not available");
  }
  return toHex(cryptoObj.getRandomValues(new Uint8Array(32)));
}

function getEvmChainId(network: Network): number {
  if (!network.startsWith("eip155:")) {
    throw new Error(`Unsupported network format: ${network} (expected eip155:CHAIN_ID)`);
  }
  const chainId = parseInt(network.split(":")[1] ?? "", 10);
  if (Number.isNaN(chainId)) {
    throw new Error(`Invalid CAIP-2 chain ID: ${network}`);
  }
  return chainId;
}

export function toClientEvmSigner(
  account: LocalAccount,
  publicClient: PublicClient,
): ClientEvmSigner {
  return {
    address: account.address,
    signTypedData: (message) =>
      account.signTypedData(
        message as Parameters<LocalAccount["signTypedData"]>[0],
      ),
    readContract: (args) =>
      publicClient.readContract(
        args as Parameters<PublicClient["readContract"]>[0],
      ),
  };
}

export class ExactEvmScheme {
  readonly scheme = "exact" as const;

  constructor(private readonly signer: ClientEvmSigner) {}

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
  ): Promise<{ x402Version: number; payload: ExactEvmPayload }> {
    if (!requirements.extra?.name || !requirements.extra?.version) {
      throw new Error(
        `EIP-712 domain parameters (name, version) are required in payment requirements for asset ${requirements.asset}`,
      );
    }

    const escrowExtra = getEscrowExtra(requirements);

    const now = Math.floor(Date.now() / 1000);
    const authorization: ExactEvmAuthorization = {
      from: this.signer.address,
      to: getAddress(requirements.payTo),
      value: requirements.amount,
      validAfter: (now - 600).toString(),
      validBefore: (now + requirements.maxTimeoutSeconds).toString(),
      nonce: escrowExtra
        ? deriveEscrowNonce(BigInt(escrowExtra.escrowId), escrowExtra.salt)
        : createNonce(),
    };

    const chainId = getEvmChainId(requirements.network);
    const domain = {
      name: requirements.extra.name,
      version: requirements.extra.version,
      chainId,
      verifyingContract: getAddress(requirements.asset),
    };
    const message = {
      from: getAddress(authorization.from),
      to: getAddress(authorization.to),
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    };

    const types = escrowExtra
      ? ReceiveWithAuthorizationTypes
      : TransferWithAuthorizationTypes;
    const signature = await this.signer.signTypedData({
      domain,
      types: types as unknown as Record<string, unknown>,
      primaryType: escrowExtra
        ? "ReceiveWithAuthorization"
        : "TransferWithAuthorization",
      message,
    });

    return {
      x402Version,
      payload: { authorization, signature },
    };
  }
}

const defaultSelect: SelectPaymentRequirements = (_x402Version, requirements) => {
  const chosen = requirements[0];
  if (!chosen) {
    throw new Error("No payment requirements available to select");
  }
  return chosen;
};

export class x402Client {
  private readonly schemes = new Map<Network, ExactEvmScheme>();
  private readonly select: SelectPaymentRequirements;

  constructor(select?: SelectPaymentRequirements) {
    this.select = select ?? defaultSelect;
  }

  register(network: Network, scheme: ExactEvmScheme): this {
    this.schemes.set(network, scheme);
    return this;
  }

  selectPaymentRequirements(
    x402Version: number,
    accepts: PaymentRequirements[],
  ): PaymentRequirements {
    const supported = accepts.filter((requirement) =>
      this.schemes.has(requirement.network),
    );
    const candidates = supported.length > 0 ? supported : accepts;
    return this.select(x402Version, candidates);
  }

  async createPaymentPayload(paymentRequired: PaymentRequired): Promise<PaymentPayload> {
    const requirements = this.selectPaymentRequirements(
      paymentRequired.x402Version,
      paymentRequired.accepts,
    );
    const scheme = this.schemes.get(requirements.network);
    if (!scheme) {
      throw new Error(
        `No client registered for scheme: ${requirements.scheme} and network: ${requirements.network}`,
      );
    }

    const partial = await scheme.createPaymentPayload(
      paymentRequired.x402Version,
      requirements,
    );

    return {
      x402Version: partial.x402Version,
      payload: partial.payload as unknown as Record<string, unknown>,
      extensions: paymentRequired.extensions,
      resource: paymentRequired.resource,
      accepted: requirements,
    };
  }
}

export function wrapFetchWithPayment(
  baseFetch: typeof fetch,
  client: x402Client,
): typeof fetch {
  return (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const request = new Request(input, init);
    if (request.headers.has("payment-signature")) {
      throw new Error("Payment already attempted");
    }
    const clonedRequest = request.clone();

    const response = await baseFetch(request);
    if (response.status !== 402) {
      return response;
    }

    const paymentRequiredHeader = response.headers.get("payment-required");
    if (!paymentRequiredHeader) {
      throw new Error("Failed to parse payment requirements: missing payment-required header");
    }

    let paymentRequired: PaymentRequired;
    try {
      paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
    } catch (error) {
      throw new Error(
        `Failed to parse payment requirements: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    let paymentPayload: PaymentPayload;
    try {
      paymentPayload = await client.createPaymentPayload(paymentRequired);
    } catch (error) {
      throw new Error(
        `Failed to create payment payload: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    clonedRequest.headers.set(
      "payment-signature",
      encodePaymentSignatureHeader(paymentPayload),
    );

    return baseFetch(clonedRequest);
  }) as typeof fetch;
}

export type { SelectPaymentRequirements } from "../types.js";

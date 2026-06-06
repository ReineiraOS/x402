import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "./types.js";
import { verifyExact } from "./exact/verify.js";
import { settleExact, type FacilitatorEvmSigner } from "./exact/settle.js";

export type SupportedKind = {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
};

export type SupportedResponse = {
  kinds: SupportedKind[];
  extensions: string[];
  signers: Record<string, string[]>;
};

type RegisteredScheme = {
  scheme: string;
  signer: FacilitatorEvmSigner;
};

const EXACT_SCHEME = "exact";

function caipFamily(network: Network): string {
  return network.split(":")[0] ?? network;
}

export class X402Facilitator {
  private readonly schemes = new Map<Network, RegisteredScheme>();

  registerExact(networks: Network | Network[], signer: FacilitatorEvmSigner): this {
    const list = Array.isArray(networks) ? networks : [networks];
    for (const network of list) {
      this.schemes.set(network, { scheme: EXACT_SCHEME, signer });
    }
    return this;
  }

  getSupported(): SupportedResponse {
    const kinds: SupportedKind[] = [];
    const signersByFamily: Record<string, Set<string>> = {};

    for (const [network, registered] of this.schemes) {
      kinds.push({
        x402Version: 2,
        scheme: registered.scheme,
        network,
      });
      const family = caipFamily(network);
      if (!signersByFamily[family]) {
        signersByFamily[family] = new Set();
      }
      for (const address of registered.signer.getAddresses()) {
        signersByFamily[family].add(address);
      }
    }

    const signers: Record<string, string[]> = {};
    for (const [family, set] of Object.entries(signersByFamily)) {
      signers[family] = [...set];
    }

    return { kinds, extensions: [], signers };
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const registered = this.resolveScheme(paymentRequirements);
    return verifyExact(paymentPayload, paymentRequirements, {
      publicClient: registered.signer,
    });
  }

  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const registered = this.resolveScheme(paymentRequirements);
    return settleExact(paymentPayload, paymentRequirements, {
      signer: registered.signer,
      publicClient: registered.signer,
    });
  }

  private resolveScheme(requirements: PaymentRequirements): RegisteredScheme {
    const registered = this.schemes.get(requirements.network);
    if (!registered || registered.scheme !== requirements.scheme) {
      throw new Error(
        `No facilitator registered for scheme: ${requirements.scheme} and network: ${requirements.network}`,
      );
    }
    return registered;
  }
}

export interface RegisterExactEvmSchemeConfig {
  signer: FacilitatorEvmSigner;
  networks: Network | Network[];
}

export function registerExactEvmScheme(
  facilitator: X402Facilitator,
  config: RegisterExactEvmSchemeConfig,
): X402Facilitator {
  return facilitator.registerExact(config.networks, config.signer);
}

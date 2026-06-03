import type { Address, Hex } from "viem";

export interface X402RssConfig {
  chainId: number;
  usdc: Address;
  escrow: Address;
  facilitatorUrl: string;
}

export interface SettleRequest {
  payer: Address;
  payee: Address;
  amount: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  signature: Hex;
  conditionId?: Hex;
  insurancePolicyId?: Hex;
}

export interface QuoteRequest {
  amount: bigint;
  payee: Address;
  conditionId?: Hex;
}

export interface Quote {
  amount: bigint;
  protocolFee: bigint;
  insurancePremium: bigint;
  total: bigint;
  validUntil: bigint;
}

export interface SettleResult {
  escrowId: Hex;
  txHash: Hex;
  conditionId?: Hex;
  insurancePolicyId?: Hex;
  settledAt: bigint;
}

export interface X402RssClient {
  readonly config: X402RssConfig;
  quote(request: QuoteRequest): Promise<Quote>;
  settle(request: SettleRequest): Promise<SettleResult>;
}

const NOT_IMPLEMENTED = "x402-rss: not implemented (A1 / DEV-189)";

export function createX402RssClient(config: X402RssConfig): X402RssClient {
  return {
    config,
    async quote(_request: QuoteRequest): Promise<Quote> {
      throw new Error(NOT_IMPLEMENTED);
    },
    async settle(_request: SettleRequest): Promise<SettleResult> {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}

export type {
  Network,
  ResourceInfo,
  PaymentRequirements,
  PaymentRequired,
  ExactEvmAuthorization,
  ExactEvmPayload,
  PaymentPayload,
  VerifyResponse,
  SettleResponse,
  SelectPaymentRequirements,
} from "./types.js";

export {
  encodePaymentRequiredHeader,
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
  decodePaymentSignatureHeader,
} from "./http.js";

export {
  toClientEvmSigner,
  ExactEvmScheme,
  x402Client,
  wrapFetchWithPayment,
  type ClientEvmSigner,
} from "./exact/client.js";

export { verifyExact, type VerifyExactContext } from "./exact/verify.js";

export {
  getEscrowExtra,
  deriveEscrowNonce,
  encodePaymentAuthorization,
  ReceiveWithAuthorizationTypes,
  type EscrowPaymentExtra,
} from "./exact/escrow.js";

export {
  toFacilitatorEvmSigner,
  settleExact,
  type FacilitatorEvmSigner,
  type SettleExactContext,
} from "./exact/settle.js";

export {
  X402Facilitator,
  registerExactEvmScheme,
  type SupportedKind,
  type SupportedResponse,
  type RegisterExactEvmSchemeConfig,
} from "./facilitator.js";

export {
  createConfidentialClient,
  encryptUint64,
  encryptAddress,
  decryptUint64,
  type ConfidentialClient,
  type EncryptedInput,
} from "./exact/confidential.js";

export {
  createConfidentialEscrow,
  readConfidentialAmount,
  type ConfidentialViem,
  type CreateConfidentialEscrowParams,
} from "./exact/confidential-escrow.js";

export {
  purchaseConfidentialCoverage,
  disputeConfidentialCoverage,
  getCoverageStatus,
  type PurchaseConfidentialCoverageParams,
} from "./exact/confidential-coverage.js";

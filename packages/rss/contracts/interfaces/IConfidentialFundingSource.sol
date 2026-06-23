// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title IConfidentialFundingSource
/// @notice Confidential variant of {IFundingSource}. A pluggable entrypoint that settles an
///         inbound payment (x402 / EIP-3009, CCTP, fiat attestation, …) by funding a confidential
///         escrow. Unlike {IFundingSource}, `settle` MUST NOT return a plaintext amount — returning
///         the funded sum in the clear would defeat confidentiality — so it returns an encrypted
///         handle (`euint64`) and any amount it emits MUST be encrypted.
interface IConfidentialFundingSource {
    /// @notice Settle an inbound payment by funding the confidential escrow `escrowId`.
    /// @param escrowId The confidential escrow to fund.
    /// @param fundingProof Opaque proof authorising the payment (e.g. an EIP-3009 authorization).
    /// @return funded The encrypted amount the escrow was funded with. No plaintext is revealed.
    function settle(uint256 escrowId, bytes calldata fundingProof) external returns (euint64 funded);
}

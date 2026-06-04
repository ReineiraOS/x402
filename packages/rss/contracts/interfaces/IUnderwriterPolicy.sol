// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IUnderwriterPolicy — Pluggable risk evaluation and dispute resolution (plain variant)
/// @notice Implement this interface to define a complete underwriter policy
///         for the Insurance protocol. Each underwriter deploys their own policy
///         that determines:
///         1. How coverage-specific data is registered (e.g., dispute identifiers)
///         2. How risk is evaluated from proof data (e.g., zkTLS/zkFetch attestations)
///         3. How disputes are judged when claims are filed
/// @dev Must implement ERC-165 so IPolicyRegistry can validate the interface.
///      For the confidential (FHE) variant see {IConfidentialUnderwriterPolicy}.
interface IUnderwriterPolicy is IERC165 {
    /// @notice Called by CoverageManager when coverage is created to register policy-specific data
    /// @param coverageId The coverage identifier
    /// @param data Policy-specific configuration data (e.g., PayPal dispute ID)
    function onPolicySet(uint256 coverageId, bytes calldata data) external;

    /// @notice Evaluates risk from proof data and returns a risk score
    /// @param escrowId The escrow being evaluated
    /// @param riskProof Opaque proof bytes (e.g., zkFetch attestation of dispute data)
    /// @return riskScore Risk score used to compute the premium
    function evaluateRisk(uint256 escrowId, bytes calldata riskProof) external returns (uint256 riskScore);

    /// @notice Evaluates whether a dispute is valid
    /// @param coverageId The coverage being disputed
    /// @param disputeProof Opaque proof bytes (e.g., zkFetch attestation of dispute resolution)
    /// @return valid True if the dispute is upheld
    function judge(uint256 coverageId, bytes calldata disputeProof) external returns (bool valid);
}

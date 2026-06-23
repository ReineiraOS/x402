// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {euint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title IConfidentialUnderwriterPolicy — Confidential pluggable risk evaluation and dispute resolution
/// @notice Confidential variant of {IUnderwriterPolicy}. Risk scores and dispute verdicts are
///         encrypted: `evaluateRisk` returns an encrypted score and `judge` returns an encrypted
///         boolean, so a coverage manager can branch on the verdict without revealing it. Matches
///         the policy interface consumed by the deployed Reineira `ConfidentialCoverageManager`.
/// @dev Must implement ERC-165 so a policy registry can validate the interface.
interface IConfidentialUnderwriterPolicy is IERC165 {
    /// @notice Called by the coverage manager when coverage is created to register policy data.
    /// @param coverageId The coverage identifier.
    /// @param data Policy-specific configuration data.
    function onPolicySet(uint256 coverageId, bytes calldata data) external;

    /// @notice Evaluates risk from proof data and returns an encrypted risk score.
    /// @param escrowId The escrow being evaluated.
    /// @param riskProof Opaque proof bytes.
    /// @return riskScore Encrypted risk score used to compute the premium.
    function evaluateRisk(uint256 escrowId, bytes calldata riskProof) external returns (euint64 riskScore);

    /// @notice Evaluates whether a dispute is valid, returning an encrypted verdict.
    /// @param coverageId The coverage being disputed.
    /// @param disputeProof Opaque proof bytes.
    /// @return valid Encrypted boolean — true if the dispute is upheld.
    function judge(uint256 coverageId, bytes calldata disputeProof) external returns (ebool valid);
}

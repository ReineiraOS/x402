// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IConditionResolver} from "./IConditionResolver.sol";

/// @title IConfidentialConditionResolver
/// @notice A condition resolver whose decision PARAMETERS are confidential (an encrypted
///         threshold) while the verdict it exposes to a plaintext-gated escrow stays a public
///         bool via {IConditionResolver-isConditionMet}. The threshold is never revealed; only the
///         single breach bit is. This lets a circuit-breaker keep its exact trip point secret from
///         an attacker while the halt itself remains publicly observable.
/// @dev Extends {IConditionResolver} so it plugs into escrows that gate on a plaintext verdict.
///      Production implementations reveal the verdict bit via asynchronous on-chain decryption of
///      the encrypted comparison; the verdict MUST NOT leak the threshold itself.
interface IConfidentialConditionResolver is IConditionResolver {
    /// @notice The encrypted threshold the condition is evaluated against.
    /// @dev Returns an opaque handle; only ACL-permitted parties can decrypt it.
    /// @param escrowId The escrow identifier.
    /// @return The encrypted threshold.
    function getEncryptedThreshold(uint256 escrowId) external view returns (euint64);
}

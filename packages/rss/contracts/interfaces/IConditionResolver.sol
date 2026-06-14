// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IConditionResolver
/// @notice Resolves whether an escrow's release condition has been met and exposes
///         the per-escrow condition fee charged when the escrow is created.
/// @dev Implement this interface to plug a custom condition into the escrow contract that
///      integrates this resolver. That contract calls `onConditionSet` when a condition is
///      attached to a new escrow, `getConditionFee` when the fee is stamped, and
///      `isConditionMet` before allowing redemption. Implementations must support ERC-165 so
///      callers can validate the interface.
interface IConditionResolver is IERC165 {
    /// @notice Checks whether the redemption condition for a given escrow is satisfied
    /// @param escrowId The escrow identifier to evaluate
    /// @return True if the condition is met and the escrow can be redeemed
    function isConditionMet(uint256 escrowId) external view returns (bool);

    /// @notice Called by the integrating escrow contract when a condition is attached to a new escrow
    /// @param escrowId The escrow identifier
    /// @param data Resolver-specific configuration data forwarded by the escrow contract
    function onConditionSet(uint256 escrowId, bytes calldata data) external;

    /// @notice Returns the condition fee that should be stamped on the escrow
    /// @dev Fees in the standard are expressed in basis points and bounded to the 0–10000 range
    ///      (10000 bps = 100%). The integrating escrow contract is responsible for enforcing that
    ///      the sum of all stamped fees stays within bounds; there is no per-fee on-chain cap here.
    /// @param escrowId The escrow identifier the fee applies to
    /// @return bps The fee in basis points (0–10000)
    /// @return recipient The address that should receive the fee at redemption
    function getConditionFee(uint256 escrowId) external view returns (uint16 bps, address recipient);
}

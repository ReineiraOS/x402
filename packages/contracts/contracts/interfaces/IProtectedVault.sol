// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IProtectedVault
/// @notice Minimal invariant object guarded by the Two-Key Halt showcase. It is NOT a custody
///         vault: `totalAssets` is an accounting figure, `recordedFloor` its high-water mark.
///         A drain that pushes `totalAssets` below `recordedFloor` is the breach signal the
///         AlertResolver reads. The Guardian (PAUSER_ROLE) can freeze it; the staged attacker
///         (DEMO_ROLE) can drain it via the clearly-labelled `demoDrain` hook.
interface IProtectedVault {
    function totalAssets() external view returns (uint256);

    function recordedFloor() external view returns (uint256);

    function isHealthy() external view returns (bool);

    function paused() external view returns (bool);

    function deposit(uint256 amount) external;

    function withdraw(uint256 amount) external;

    function pause() external;

    function unpause() external;

    function demoDrain(uint256 amount) external;
}

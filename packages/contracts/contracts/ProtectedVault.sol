// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ProtectedVault
/// @notice The on-chain object the Two-Key Halt showcase protects. It is intentionally NOT a
///         custody vault — `totalAssets` is an accounting figure and `recordedFloor` its
///         high-water mark. A drain that pushes `totalAssets` below `recordedFloor` breaks the
///         health invariant; that real on-chain flag is what the AlertResolver reads to rule an
///         alert valid. Two keys, neither acting alone: PAUSER_ROLE (the Guardian) can freeze the
///         vault but cannot move value; DEMO_ROLE (the operator/staged-attacker) drives the
///         labelled deposit / withdraw / drain hooks. The two roles are siloed (each is its own
///         role-admin) so the deployer cannot escalate into them and collapse the separation.
contract ProtectedVault is Pausable, AccessControl {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant DEMO_ROLE = keccak256("DEMO_ROLE");

    uint256 public totalAssets;
    uint256 public recordedFloor;

    event Deposited(address indexed from, uint256 amount, uint256 totalAssets);
    event Withdrawn(address indexed to, uint256 amount, uint256 totalAssets);
    event StagedExploit(uint256 amount, uint256 totalAssetsAfter, uint256 recordedFloor);

    error AmountExceedsBalance();
    error ZeroAmount();

    constructor(address admin, address pauser, address demoActor) {
        // Silo PAUSER_ROLE and DEMO_ROLE under themselves so DEFAULT_ADMIN_ROLE cannot grant them
        // post-deploy — the "two keys, neither acts alone" separation is then enforced on-chain.
        _setRoleAdmin(PAUSER_ROLE, PAUSER_ROLE);
        _setRoleAdmin(DEMO_ROLE, DEMO_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (pauser != address(0)) _grantRole(PAUSER_ROLE, pauser);
        if (demoActor != address(0)) _grantRole(DEMO_ROLE, demoActor);
    }

    function deposit(uint256 amount) external onlyRole(DEMO_ROLE) whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        totalAssets += amount;
        if (totalAssets > recordedFloor) recordedFloor = totalAssets;
        emit Deposited(msg.sender, amount, totalAssets);
    }

    function withdraw(uint256 amount) external onlyRole(DEMO_ROLE) whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (amount > totalAssets) revert AmountExceedsBalance();
        totalAssets -= amount;
        emit Withdrawn(msg.sender, amount, totalAssets);
    }

    function isHealthy() external view returns (bool) {
        return totalAssets >= recordedFloor;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Staged-attacker hook. Role-gated, event-labelled and `whenNotPaused` so a Guardian
    ///         freeze genuinely halts it. Performs the one real on-chain write that flips
    ///         `totalAssets` below `recordedFloor`, making the AlertResolver verdict genuine.
    function demoDrain(uint256 amount) external onlyRole(DEMO_ROLE) whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (amount > totalAssets) revert AmountExceedsBalance();
        totalAssets -= amount;
        emit StagedExploit(amount, totalAssets, recordedFloor);
    }
}

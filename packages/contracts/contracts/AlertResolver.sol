// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IConditionResolver} from "@reineira-os/rss/contracts/interfaces/IConditionResolver.sol";
import {IProtectedVault} from "./interfaces/IProtectedVault.sol";

/// @title AlertResolver
/// @notice Two-Key Halt verdict oracle, shaped exactly like {DeliveryDeadlineResolver}. When the
///         Sentinel stakes a bond ("stake to speak") the escrow attaches this resolver and
///         snapshots the protected vault's floor. The bond becomes redeemable only if the alert
///         was VALID — i.e. the vault's `totalAssets` later fell below that snapshot. The verdict
///         is a pure on-chain read of real state the staged attacker actually flipped; no operator
///         decides it. A false alarm leaves `isConditionMet` false, so the bond stays locked.
contract AlertResolver is IConditionResolver, ERC165 {
    struct Alert {
        address sentinel;
        uint256 floorSnapshot;
        bool configured;
        bool breachLatched;
    }

    address public immutable escrow;
    IProtectedVault public immutable vault;

    mapping(uint256 => Alert) private _alerts;

    event AlertConfigured(uint256 indexed escrowId, uint256 floorSnapshot, address sentinel);
    event BreachLatched(uint256 indexed escrowId, uint256 totalAssets);

    error InvalidEscrow();
    error InvalidVault();
    error NotEscrow();
    error AlreadyConfigured(uint256 escrowId);
    error NotConfigured(uint256 escrowId);

    constructor(address escrow_, address vault_) {
        if (escrow_ == address(0)) revert InvalidEscrow();
        if (vault_ == address(0)) revert InvalidVault();
        escrow = escrow_;
        vault = IProtectedVault(vault_);
    }

    function onConditionSet(uint256 escrowId, bytes calldata data) external override {
        if (msg.sender != escrow) revert NotEscrow();
        Alert storage alert = _alerts[escrowId];
        if (alert.configured) revert AlreadyConfigured(escrowId);

        address sentinel = abi.decode(data, (address));
        alert.sentinel = sentinel;
        alert.floorSnapshot = vault.recordedFloor();
        alert.configured = true;

        emit AlertConfigured(escrowId, alert.floorSnapshot, sentinel);
    }

    /// @notice Latch the breach the first time it is observed on-chain. Permissionless and
    ///         idempotent. Once latched, restoring the vault to health cannot revert the verdict,
    ///         so a legitimately-earned bond can never be locked by a same-block re-deposit or a
    ///         demo-reset that heals the vault before the Sentinel's redeem lands.
    function latchBreach(uint256 escrowId) external {
        Alert storage alert = _alerts[escrowId];
        if (!alert.configured) revert NotConfigured(escrowId);
        uint256 currentAssets = vault.totalAssets();
        if (!alert.breachLatched && currentAssets < alert.floorSnapshot) {
            alert.breachLatched = true;
            emit BreachLatched(escrowId, currentAssets);
        }
    }

    function isConditionMet(uint256 escrowId) external view override returns (bool) {
        return _isBreached(escrowId);
    }

    function isBreached(uint256 escrowId) external view returns (bool) {
        return _isBreached(escrowId);
    }

    function _isBreached(uint256 escrowId) internal view returns (bool) {
        Alert storage alert = _alerts[escrowId];
        return alert.configured && (alert.breachLatched || vault.totalAssets() < alert.floorSnapshot);
    }

    function getConditionFee(uint256) external pure override returns (uint16 bps, address recipient) {
        return (0, address(0));
    }

    function floorOf(uint256 escrowId) external view returns (uint256) {
        return _alerts[escrowId].floorSnapshot;
    }

    function sentinelOf(uint256 escrowId) external view returns (address) {
        return _alerts[escrowId].sentinel;
    }

    function isConfigured(uint256 escrowId) external view returns (bool) {
        return _alerts[escrowId].configured;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IConditionResolver).interfaceId || super.supportsInterface(interfaceId);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ConditionResolverConformance} from "@reineira-os/rss/test/conformance/ConditionResolverConformance.t.sol";
import {IConditionResolver} from "@reineira-os/rss/contracts/interfaces/IConditionResolver.sol";
import {AlertResolver} from "../contracts/AlertResolver.sol";
import {ProtectedVault} from "../contracts/ProtectedVault.sol";

contract AlertResolverTest is ConditionResolverConformance {
    AlertResolver internal alertResolver;
    ProtectedVault internal vault;
    address internal sentinel = address(0x5E27);

    function _deploy() internal override returns (IConditionResolver, uint256) {
        vault = new ProtectedVault(address(this), address(this), address(this));
        vault.deposit(100);
        alertResolver = new AlertResolver(address(this), address(vault));
        return (IConditionResolver(address(alertResolver)), 1);
    }

    function _configure() internal override {
        alertResolver.onConditionSet(escrowId, abi.encode(sentinel));
    }

    function _satisfy() internal override {
        vault.demoDrain(40);
    }

    function test_healthyVault_notBreached() public {
        _configure();
        assertFalse(alertResolver.isBreached(escrowId));
        assertFalse(alertResolver.isConditionMet(escrowId));
    }

    function test_floorSnapshotAndSentinelRecorded() public {
        _configure();
        assertEq(alertResolver.floorOf(escrowId), 100);
        assertEq(alertResolver.sentinelOf(escrowId), sentinel);
        assertTrue(alertResolver.isConfigured(escrowId));
    }

    function test_breach_afterDemoDrain() public {
        _configure();
        vault.demoDrain(40);
        assertTrue(alertResolver.isBreached(escrowId));
        assertTrue(alertResolver.isConditionMet(escrowId));
    }

    function test_onConditionSet_onlyEscrow() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(AlertResolver.NotEscrow.selector);
        alertResolver.onConditionSet(escrowId, abi.encode(sentinel));
    }

    function test_latch_survivesVaultRestore() public {
        _configure();
        vault.demoDrain(40);
        assertTrue(alertResolver.isConditionMet(escrowId));
        alertResolver.latchBreach(escrowId);
        // heal the vault back to its floor — without the latch this would lock the bond.
        vault.deposit(40);
        assertTrue(vault.isHealthy());
        assertTrue(alertResolver.isConditionMet(escrowId));
    }

    function test_latch_noopWhenHealthy() public {
        _configure();
        alertResolver.latchBreach(escrowId);
        assertFalse(alertResolver.isConditionMet(escrowId));
    }

    function test_onConditionSet_double_reverts() public {
        _configure();
        vm.expectRevert(abi.encodeWithSelector(AlertResolver.AlreadyConfigured.selector, escrowId));
        alertResolver.onConditionSet(escrowId, abi.encode(sentinel));
    }

    function test_latchBreach_unconfigured_reverts() public {
        uint256 unconfigured = escrowId + 1;
        vm.expectRevert(abi.encodeWithSelector(AlertResolver.NotConfigured.selector, unconfigured));
        alertResolver.latchBreach(unconfigured);
    }

    function test_constructor_zeroEscrow_reverts() public {
        vm.expectRevert(AlertResolver.InvalidEscrow.selector);
        new AlertResolver(address(0), address(vault));
    }

    function test_constructor_zeroVault_reverts() public {
        vm.expectRevert(AlertResolver.InvalidVault.selector);
        new AlertResolver(address(this), address(0));
    }
}

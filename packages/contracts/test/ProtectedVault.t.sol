// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {ProtectedVault} from "../contracts/ProtectedVault.sol";

contract ProtectedVaultTest is Test {
    ProtectedVault internal vault;
    address internal guardian = address(0x647D1A);
    address internal stranger = address(0x57A4); // holds no roles

    function setUp() public {
        // admin + DEMO_ROLE = this test contract; PAUSER_ROLE = the distinct guardian.
        vault = new ProtectedVault(address(this), guardian, address(this));
        vault.deposit(1000);
    }

    function test_depositSetsFloor() public view {
        assertEq(vault.totalAssets(), 1000);
        assertEq(vault.recordedFloor(), 1000);
        assertTrue(vault.isHealthy());
    }

    function test_demoDrainFlipsHealth() public {
        vault.demoDrain(400);
        assertEq(vault.totalAssets(), 600);
        assertEq(vault.recordedFloor(), 1000);
        assertFalse(vault.isHealthy());
    }

    function test_deposit_demoGated() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.deposit(1);
    }

    function test_withdraw_demoGated() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.withdraw(1);
    }

    function test_demoDrain_demoGated() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.demoDrain(1);
    }

    function test_admin_cannotPause() public {
        // the admin/DEMO key is NOT the Guardian — it cannot pause.
        vm.expectRevert();
        vault.pause();
    }

    function test_admin_cannotEscalateToPauser() public {
        // PAUSER_ROLE is siloed under itself: DEFAULT_ADMIN cannot grant it (two-key separation).
        bytes32 pauserRole = vault.PAUSER_ROLE();
        assertEq(vault.getRoleAdmin(pauserRole), pauserRole);
        vm.expectRevert();
        vault.grantRole(pauserRole, address(this));
    }

    function test_guardianPausesAndUnpauses() public {
        vm.prank(guardian);
        vault.pause();
        assertTrue(vault.paused());
        vm.prank(guardian);
        vault.unpause();
        assertFalse(vault.paused());
    }

    function test_pausedBlocksDeposit() public {
        vm.prank(guardian);
        vault.pause();
        vm.expectRevert();
        vault.deposit(1);
    }

    function test_pausedBlocksDemoDrain() public {
        vm.prank(guardian);
        vault.pause();
        vm.expectRevert();
        vault.demoDrain(1);
    }

    function test_floorNeverLowers() public {
        vault.withdraw(500);
        assertEq(vault.totalAssets(), 500);
        assertEq(vault.recordedFloor(), 1000);
        assertFalse(vault.isHealthy());
    }

    function test_zeroDepositReverts() public {
        vm.expectRevert(ProtectedVault.ZeroAmount.selector);
        vault.deposit(0);
    }
}

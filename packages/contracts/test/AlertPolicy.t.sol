// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {ProtectedVault} from "../contracts/ProtectedVault.sol";
import {AlertResolver} from "../contracts/AlertResolver.sol";
import {DeliveryPolicy} from "../contracts/DeliveryPolicy.sol";

contract AlertPolicyTest is Test {
    ProtectedVault internal vault;
    AlertResolver internal resolver;
    DeliveryPolicy internal policy;

    address internal escrowCaller = address(0xE5C);
    address internal coverageManager = address(0xC0FFEE);
    address internal guardian = address(0x647D1A);
    uint256 internal constant ESCROW_ID = 1;
    uint256 internal constant COVERAGE_ID = 7;

    function setUp() public {
        vault = new ProtectedVault(address(this), guardian, address(this));
        vault.deposit(1000);
        resolver = new AlertResolver(escrowCaller, address(vault));
        policy = new DeliveryPolicy(coverageManager, address(resolver));

        vm.prank(escrowCaller);
        resolver.onConditionSet(ESCROW_ID, abi.encode(address(this)));

        vm.prank(coverageManager);
        policy.onPolicySet(COVERAGE_ID, abi.encode(ESCROW_ID));
    }

    function test_judgeFalseWhenHealthy() public view {
        assertFalse(resolver.isBreached(ESCROW_ID));
        assertFalse(policy.judge(COVERAGE_ID, ""));
    }

    function test_judgeTrueAfterDrain() public {
        vault.demoDrain(400);
        assertTrue(resolver.isBreached(ESCROW_ID));
        assertTrue(policy.judge(COVERAGE_ID, ""));
    }
}

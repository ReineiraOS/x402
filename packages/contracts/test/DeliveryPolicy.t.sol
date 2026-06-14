// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {UnderwriterPolicyConformance} from "@reineira-os/rss/test/conformance/UnderwriterPolicyConformance.t.sol";
import {IUnderwriterPolicy} from "@reineira-os/rss/contracts/interfaces/IUnderwriterPolicy.sol";
import {DeliveryPolicy} from "../contracts/DeliveryPolicy.sol";
import {DeliveryDeadlineResolver} from "../contracts/DeliveryDeadlineResolver.sol";

contract DeliveryPolicyTest is UnderwriterPolicyConformance {
    DeliveryPolicy internal deliveryPolicy;
    DeliveryDeadlineResolver internal deliveryResolver;
    uint256 internal boundEscrowId = 7;
    uint64 internal deadline;

    function _deploy() internal override returns (IUnderwriterPolicy, uint256) {
        deliveryResolver = new DeliveryDeadlineResolver(address(this));
        deliveryPolicy = new DeliveryPolicy(address(this), address(deliveryResolver));
        return (IUnderwriterPolicy(address(deliveryPolicy)), 1);
    }

    function _bind() internal override {
        deadline = uint64(block.timestamp + 1 days);
        deliveryResolver.onConditionSet(boundEscrowId, abi.encode(uint256(deadline), address(0xA11CE)));
        deliveryPolicy.onPolicySet(coverageId, abi.encode(boundEscrowId));
    }

    function _makeValid() internal override {
        vm.warp(deadline + 1);
    }

    function test_onPolicySet_nonCoverageManager_reverts() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(DeliveryPolicy.NotCoverageManager.selector);
        deliveryPolicy.onPolicySet(coverageId, abi.encode(boundEscrowId));
    }

    function test_onPolicySet_double_reverts() public {
        _bind();
        vm.expectRevert(abi.encodeWithSelector(DeliveryPolicy.AlreadyBound.selector, coverageId));
        deliveryPolicy.onPolicySet(coverageId, abi.encode(boundEscrowId));
    }

    function test_constructor_zeroResolver_reverts() public {
        vm.expectRevert(DeliveryPolicy.InvalidResolver.selector);
        new DeliveryPolicy(address(this), address(0));
    }

    function test_constructor_zeroCoverageManager_reverts() public {
        vm.expectRevert(DeliveryPolicy.InvalidCoverageManager.selector);
        new DeliveryPolicy(address(0), address(deliveryResolver));
    }

    function test_judge_unbound_reverts() public {
        uint256 unbound = coverageId + 1;
        vm.expectRevert(abi.encodeWithSelector(DeliveryPolicy.NotBound.selector, unbound));
        deliveryPolicy.judge(unbound, "");
    }

    function test_evaluateRisk_nonCoverageManager_reverts() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(DeliveryPolicy.NotCoverageManager.selector);
        deliveryPolicy.evaluateRisk(boundEscrowId, "");
    }

    function test_evaluateRisk_fromCoverageManager_returnsZero() public view {
        assertEq(deliveryPolicy.evaluateRisk(boundEscrowId, ""), 0);
    }
}

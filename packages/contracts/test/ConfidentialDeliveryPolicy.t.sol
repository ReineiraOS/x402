// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {
    ConfidentialUnderwriterPolicyConformance
} from "@reineira-os/rss/test/conformance/ConfidentialUnderwriterPolicyConformance.t.sol";
import {IConfidentialUnderwriterPolicy} from "@reineira-os/rss/contracts/interfaces/IConfidentialUnderwriterPolicy.sol";
import {ConfidentialDeliveryPolicy} from "../contracts/ConfidentialDeliveryPolicy.sol";
import {DeliveryDeadlineResolver} from "../contracts/DeliveryDeadlineResolver.sol";

contract ConfidentialDeliveryPolicyTest is ConfidentialUnderwriterPolicyConformance {
    ConfidentialDeliveryPolicy internal policyImpl;
    DeliveryDeadlineResolver internal deliveryResolver;
    uint256 internal boundEscrowId = 7;
    uint64 internal deadline;

    function _deploy() internal override returns (IConfidentialUnderwriterPolicy, uint256) {
        deliveryResolver = new DeliveryDeadlineResolver(address(this));
        policyImpl = new ConfidentialDeliveryPolicy(address(this), address(deliveryResolver));
        return (IConfidentialUnderwriterPolicy(address(policyImpl)), 1);
    }

    function _bind() internal override {
        deadline = uint64(block.timestamp + 1 days);
        deliveryResolver.onConditionSet(boundEscrowId, abi.encode(uint256(deadline), address(0xA11CE)));
        policyImpl.onPolicySet(coverageId, abi.encode(boundEscrowId));
    }

    function _makeValid() internal override {
        vm.warp(deadline + 1);
    }

    function test_onPolicySet_nonCoverageManager_reverts() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(ConfidentialDeliveryPolicy.NotCoverageManager.selector);
        policyImpl.onPolicySet(coverageId, abi.encode(boundEscrowId));
    }

    function test_onPolicySet_double_reverts() public {
        _bind();
        vm.expectRevert(abi.encodeWithSelector(ConfidentialDeliveryPolicy.AlreadyBound.selector, coverageId));
        policyImpl.onPolicySet(coverageId, abi.encode(boundEscrowId));
    }

    function test_judge_unbound_reverts() public {
        uint256 unbound = coverageId + 1;
        vm.expectRevert(abi.encodeWithSelector(ConfidentialDeliveryPolicy.NotBound.selector, unbound));
        policyImpl.judge(unbound, "");
    }

    function test_evaluateRisk_nonCoverageManager_reverts() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(ConfidentialDeliveryPolicy.NotCoverageManager.selector);
        policyImpl.evaluateRisk(boundEscrowId, "");
    }

    function test_constructor_zeroResolver_reverts() public {
        vm.expectRevert(ConfidentialDeliveryPolicy.InvalidResolver.selector);
        new ConfidentialDeliveryPolicy(address(this), address(0));
    }

    function test_constructor_zeroCoverageManager_reverts() public {
        vm.expectRevert(ConfidentialDeliveryPolicy.InvalidCoverageManager.selector);
        new ConfidentialDeliveryPolicy(address(0), address(deliveryResolver));
    }

    function test_judge_encryptedVerdict_flipsWithBreach() public {
        _bind();
        expectPlaintext(policyImpl.judge(coverageId, ""), false);
        _makeValid();
        expectPlaintext(policyImpl.judge(coverageId, ""), true);
    }

    function test_judge_nonCoverageManager_reverts() public {
        _bind();
        vm.prank(address(0xBEEF));
        vm.expectRevert(ConfidentialDeliveryPolicy.NotCoverageManager.selector);
        policyImpl.judge(coverageId, "");
    }

    function test_judge_usesEscrowIdBinding() public {
        uint256 cidBreached = 100;
        uint256 cidHealthy = 200;
        uint256 escrowBreached = 11;
        uint256 escrowHealthy = 22;
        uint64 nearDeadline = uint64(block.timestamp + 1 hours);
        uint64 farDeadline = uint64(block.timestamp + 10 days);
        deliveryResolver.onConditionSet(escrowBreached, abi.encode(uint256(nearDeadline), address(0xA11CE)));
        deliveryResolver.onConditionSet(escrowHealthy, abi.encode(uint256(farDeadline), address(0xA11CE)));
        policyImpl.onPolicySet(cidBreached, abi.encode(escrowBreached));
        policyImpl.onPolicySet(cidHealthy, abi.encode(escrowHealthy));
        vm.warp(nearDeadline + 1);
        expectPlaintext(policyImpl.judge(cidBreached, ""), true);
        expectPlaintext(policyImpl.judge(cidHealthy, ""), false);
    }
}

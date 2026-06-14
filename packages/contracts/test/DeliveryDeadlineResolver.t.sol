// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ConditionResolverConformance} from "@reineira-os/rss/test/conformance/ConditionResolverConformance.t.sol";
import {IConditionResolver} from "@reineira-os/rss/contracts/interfaces/IConditionResolver.sol";
import {DeliveryDeadlineResolver} from "../contracts/DeliveryDeadlineResolver.sol";

contract DeliveryDeadlineResolverTest is ConditionResolverConformance {
    DeliveryDeadlineResolver internal deliveryResolver;
    address internal attester = address(0xA11CE);
    uint64 internal deadline;

    function _deploy() internal override returns (IConditionResolver, uint256) {
        deliveryResolver = new DeliveryDeadlineResolver(address(this));
        deadline = uint64(block.timestamp + 1 days);
        return (IConditionResolver(address(deliveryResolver)), 1);
    }

    function _configure() internal override {
        deliveryResolver.onConditionSet(escrowId, abi.encode(uint256(deadline), attester));
    }

    function _satisfy() internal override {
        vm.prank(attester);
        deliveryResolver.attestDelivery(escrowId);
    }

    function test_breached_afterDeadline() public {
        _configure();
        vm.warp(deadline + 1);
        assertTrue(deliveryResolver.isBreached(escrowId));
    }

    function test_onConditionSet_nonEscrow_reverts() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(DeliveryDeadlineResolver.NotEscrow.selector);
        deliveryResolver.onConditionSet(escrowId, abi.encode(uint256(deadline), attester));
    }

    function test_onConditionSet_double_reverts() public {
        _configure();
        vm.expectRevert(abi.encodeWithSelector(DeliveryDeadlineResolver.AlreadyConfigured.selector, escrowId));
        deliveryResolver.onConditionSet(escrowId, abi.encode(uint256(deadline), attester));
    }

    function test_onConditionSet_pastDeadline_reverts() public {
        uint256 pastDeadline = block.timestamp;
        vm.expectRevert(DeliveryDeadlineResolver.InvalidDeadline.selector);
        deliveryResolver.onConditionSet(escrowId, abi.encode(pastDeadline, attester));
    }

    function test_onConditionSet_zeroAttester_reverts() public {
        vm.expectRevert(DeliveryDeadlineResolver.InvalidAttester.selector);
        deliveryResolver.onConditionSet(escrowId, abi.encode(uint256(deadline), address(0)));
    }

    function test_attestDelivery_nonAttester_reverts() public {
        _configure();
        vm.prank(address(0xBEEF));
        vm.expectRevert(DeliveryDeadlineResolver.NotAttester.selector);
        deliveryResolver.attestDelivery(escrowId);
    }

    function test_attestDelivery_afterWindow_reverts() public {
        _configure();
        vm.warp(deadline + 1);
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(DeliveryDeadlineResolver.AttestationWindowClosed.selector, escrowId));
        deliveryResolver.attestDelivery(escrowId);
    }

    function test_attestDelivery_unconfigured_reverts() public {
        uint256 unconfigured = escrowId + 1;
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(DeliveryDeadlineResolver.NotConfigured.selector, unconfigured));
        deliveryResolver.attestDelivery(unconfigured);
    }

    function test_constructor_zeroEscrow_reverts() public {
        vm.expectRevert(DeliveryDeadlineResolver.InvalidEscrow.selector);
        new DeliveryDeadlineResolver(address(0));
    }
}

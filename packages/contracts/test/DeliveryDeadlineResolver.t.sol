// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
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
}

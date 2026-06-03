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
        deliveryPolicy = new DeliveryPolicy(address(this));
        deliveryResolver = new DeliveryDeadlineResolver(address(this));
        return (IUnderwriterPolicy(address(deliveryPolicy)), 1);
    }

    function _bind() internal override {
        deadline = uint64(block.timestamp + 1 days);
        deliveryResolver.onConditionSet(boundEscrowId, abi.encode(uint256(deadline), address(0xA11CE)));
        deliveryPolicy.onPolicySet(coverageId, abi.encode(address(deliveryResolver), boundEscrowId));
    }

    function _makeValid() internal override {
        vm.warp(deadline + 1);
    }
}

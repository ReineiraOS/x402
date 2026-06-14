// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {DeliveryDeadlineResolver} from "../contracts/DeliveryDeadlineResolver.sol";
import {DeliveryPolicy} from "../contracts/DeliveryPolicy.sol";

contract Deploy is Script {
    function run() external {
        address escrow = vm.envOr("ESCROW", msg.sender);
        address coverageManager = vm.envOr("COVERAGE_MANAGER", msg.sender);
        vm.startBroadcast();
        DeliveryDeadlineResolver resolver = new DeliveryDeadlineResolver(escrow);
        new DeliveryPolicy(coverageManager, address(resolver));
        vm.stopBroadcast();
    }
}

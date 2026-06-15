// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";
import {DeliveryDeadlineResolver} from "../contracts/DeliveryDeadlineResolver.sol";
import {DeliveryPolicy} from "../contracts/DeliveryPolicy.sol";

contract DeliveryDeploy is Script {
    function run() external {
        address escrow = vm.envAddress("ESCROW_ADDRESS");
        address coverageManager = vm.envAddress("COVERAGE_MANAGER_ADDRESS");
        vm.startBroadcast();
        DeliveryDeadlineResolver resolver = new DeliveryDeadlineResolver(escrow);
        DeliveryPolicy policy = new DeliveryPolicy(coverageManager, address(resolver));
        vm.stopBroadcast();
        console.log("DELIVERY_DEADLINE_RESOLVER_ADDRESS=%s", address(resolver));
        console.log("DELIVERY_POLICY_ADDRESS=%s", address(policy));
    }
}

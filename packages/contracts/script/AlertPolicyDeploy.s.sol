// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";
import {DeliveryPolicy} from "../contracts/DeliveryPolicy.sol";

contract AlertPolicyDeploy is Script {
    function run() external {
        address coverageManager = vm.envAddress("COVERAGE_MANAGER_ADDRESS");
        address alertResolver = vm.envAddress("ALERT_RESOLVER_ADDRESS");
        vm.startBroadcast();
        DeliveryPolicy policy = new DeliveryPolicy(coverageManager, alertResolver);
        vm.stopBroadcast();
        console.log("ALERT_POLICY_ADDRESS=%s", address(policy));
    }
}

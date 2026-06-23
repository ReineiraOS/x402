// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";
import {ConfidentialDeliveryPolicy} from "../contracts/ConfidentialDeliveryPolicy.sol";

contract ConfidentialDeliveryDeploy is Script {
    function run() external {
        address coverageManager = vm.envAddress("CONFIDENTIAL_COVERAGE_MANAGER_ADDRESS");
        address resolver = vm.envAddress("DELIVERY_DEADLINE_RESOLVER_ADDRESS");
        vm.startBroadcast();
        ConfidentialDeliveryPolicy policy = new ConfidentialDeliveryPolicy(coverageManager, resolver);
        vm.stopBroadcast();
        console.log("CONFIDENTIAL_DELIVERY_POLICY_ADDRESS=%s", address(policy));
    }
}

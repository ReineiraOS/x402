// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";
import {AlertResolver} from "../contracts/AlertResolver.sol";

contract AlertResolverDeploy is Script {
    function run() external {
        address escrow = vm.envAddress("ESCROW_ADDRESS");
        address vault = vm.envAddress("VAULT_ADDRESS");
        vm.startBroadcast();
        AlertResolver resolver = new AlertResolver(escrow, vault);
        vm.stopBroadcast();
        console.log("ALERT_RESOLVER_ADDRESS=%s", address(resolver));
    }
}

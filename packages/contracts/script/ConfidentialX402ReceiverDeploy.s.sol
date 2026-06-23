// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";
import {ConfidentialX402EscrowReceiver} from "../contracts/ConfidentialX402EscrowReceiver.sol";

contract ConfidentialX402ReceiverDeploy is Script {
    function run() external {
        address usdc = vm.envAddress("USDC_ADDRESS");
        address confidentialUsdc = vm.envAddress("CONFIDENTIAL_USDC_ADDRESS");
        address escrow = vm.envAddress("CONFIDENTIAL_ESCROW_ADDRESS");
        vm.startBroadcast();
        ConfidentialX402EscrowReceiver receiver = new ConfidentialX402EscrowReceiver(usdc, confidentialUsdc, escrow);
        vm.stopBroadcast();
        console.log("CONFIDENTIAL_X402_RECEIVER_ADDRESS=%s", address(receiver));
    }
}

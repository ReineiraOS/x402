// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";
import {X402EscrowReceiver} from "../contracts/X402EscrowReceiver.sol";

contract X402ReceiverDeploy is Script {
    function run() external {
        address usdc = vm.envAddress("USDC_ADDRESS");
        address escrow = vm.envAddress("ESCROW_ADDRESS");
        vm.startBroadcast();
        X402EscrowReceiver receiver = new X402EscrowReceiver(usdc, escrow);
        vm.stopBroadcast();
        console.log("X402_RECEIVER_ADDRESS=%s", address(receiver));
    }
}

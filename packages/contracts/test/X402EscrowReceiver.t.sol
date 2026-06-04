// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {X402EscrowReceiver} from "../contracts/X402EscrowReceiver.sol";

contract X402EscrowReceiverTest is Test {
    function test_deploys() public {
        address usdc = makeAddr("usdc");
        address escrow = makeAddr("escrow");
        X402EscrowReceiver recv = new X402EscrowReceiver(usdc, escrow);
        assertEq(recv.usdc(), usdc);
        assertEq(address(recv.escrow()), escrow);
    }

    function test_settle_reverts_whileStub() public {
        X402EscrowReceiver recv = new X402EscrowReceiver(makeAddr("usdc"), makeAddr("escrow"));
        vm.expectRevert(X402EscrowReceiver.NotImplemented.selector);
        recv.settle(1, "");
    }
}

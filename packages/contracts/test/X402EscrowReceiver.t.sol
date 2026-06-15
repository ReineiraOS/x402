// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {X402EscrowReceiver} from "../contracts/X402EscrowReceiver.sol";

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256,
        uint256,
        bytes32,
        bytes calldata
    ) external {
        require(to == msg.sender, "to!=caller");
        require(balanceOf[from] >= value, "balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}

contract MockEscrow {
    address public immutable usdc;
    mapping(uint256 => uint256) public funded;

    constructor(address usdc_) {
        usdc = usdc_;
    }

    function fund(uint256 escrowId, uint256 amount) external {
        MockUSDC(usdc).transferFrom(msg.sender, address(this), amount);
        funded[escrowId] += amount;
    }
}

contract X402EscrowReceiverTest is Test {
    function test_deploys() public {
        address usdc = makeAddr("usdc");
        address escrow = makeAddr("escrow");
        X402EscrowReceiver recv = new X402EscrowReceiver(usdc, escrow);
        assertEq(recv.usdc(), usdc);
        assertEq(recv.escrow(), escrow);
    }

    function test_settle_pullsViaEip3009AndFundsEscrow() public {
        MockUSDC usdc = new MockUSDC();
        MockEscrow escrow = new MockEscrow(address(usdc));
        X402EscrowReceiver recv = new X402EscrowReceiver(address(usdc), address(escrow));

        address payer = makeAddr("payer");
        usdc.mint(payer, 100000);

        X402EscrowReceiver.PaymentAuthorization memory auth = X402EscrowReceiver.PaymentAuthorization({
            from: payer,
            value: 100000,
            validAfter: 0,
            validBefore: type(uint256).max,
            nonce: keccak256("nonce"),
            salt: keccak256("salt"),
            signature: hex"00112233"
        });
        bytes memory proof = abi.encode(auth);

        uint256 returned = recv.settle(21, proof);

        assertEq(returned, 100000);
        assertEq(escrow.funded(21), 100000);
        assertEq(usdc.balanceOf(address(escrow)), 100000);
        assertEq(usdc.balanceOf(payer), 0);
    }
}

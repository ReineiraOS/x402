// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {
    ConfidentialFundingSourceConformance
} from "@reineira-os/rss/test/conformance/ConfidentialFundingSourceConformance.t.sol";
import {IConfidentialFundingSource} from "@reineira-os/rss/contracts/interfaces/IConfidentialFundingSource.sol";
import {euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ConfidentialX402EscrowReceiver} from "../contracts/ConfidentialX402EscrowReceiver.sol";

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

contract MockConfidentialUsdc {
    address public immutable usdc;
    uint256 private immutable _rate;
    mapping(address => address) public operatorOf;
    mapping(address => uint256) public wrapped;

    constructor(address usdc_, uint256 rate_) {
        usdc = usdc_;
        _rate = rate_;
    }

    function rate() external view returns (uint256) {
        return _rate;
    }

    function setOperator(address operator_, uint48) external {
        operatorOf[msg.sender] = operator_;
    }

    function wrap(address to, uint256 amount) external {
        MockUSDC(usdc).transferFrom(msg.sender, address(this), amount);
        wrapped[to] += amount;
    }
}

contract MockConfidentialEscrow {
    mapping(uint256 => euint64) public funded;
    mapping(uint256 => bool) public wasFunded;

    function fundFrom(uint256 escrowId, euint64 amount) external {
        funded[escrowId] = amount;
        wasFunded[escrowId] = true;
    }
}

contract ConfidentialX402EscrowReceiverTest is ConfidentialFundingSourceConformance {
    MockUSDC internal usdc;
    MockConfidentialUsdc internal cusdc;
    MockConfidentialEscrow internal mockEscrow;
    ConfidentialX402EscrowReceiver internal receiver;
    address internal payer;

    function _deploy() internal override returns (IConfidentialFundingSource, uint256) {
        usdc = new MockUSDC();
        cusdc = new MockConfidentialUsdc(address(usdc), 1);
        mockEscrow = new MockConfidentialEscrow();
        receiver = new ConfidentialX402EscrowReceiver(address(usdc), address(cusdc), address(mockEscrow));
        payer = makeAddr("payer");
        usdc.mint(payer, 10_000_000);
        return (IConfidentialFundingSource(address(receiver)), 1);
    }

    function _proofFor(uint64 amount) internal view override returns (bytes memory) {
        return _authFor(payer, amount, keccak256(abi.encode(amount)));
    }

    function _fundedAmount(uint256 id) internal view override returns (euint64) {
        return mockEscrow.funded(id);
    }

    function _authFor(address from, uint256 value, bytes32 nonce) internal pure returns (bytes memory) {
        ConfidentialX402EscrowReceiver.PaymentAuthorization memory auth =
            ConfidentialX402EscrowReceiver.PaymentAuthorization({
                from: from,
                value: value,
                validAfter: 0,
                validBefore: type(uint256).max,
                nonce: nonce,
                salt: bytes32(0),
                signature: hex"00"
            });
        return abi.encode(auth);
    }

    function test_constructor_setsImmutablesApprovesAndOperator() public view {
        assertEq(receiver.usdc(), address(usdc));
        assertEq(receiver.confidentialUsdc(), address(cusdc));
        assertEq(receiver.escrow(), address(mockEscrow));
        assertEq(usdc.allowance(address(receiver), address(cusdc)), type(uint256).max);
        assertEq(cusdc.operatorOf(address(receiver)), address(mockEscrow));
    }

    function test_settle_movesPlaintextUsdcThroughWrap() public {
        uint64 amount = 250_000;
        receiver.settle(7, _proofFor(amount));
        assertEq(usdc.balanceOf(payer), 10_000_000 - amount);
        assertEq(cusdc.wrapped(address(receiver)), amount);
        assertTrue(mockEscrow.wasFunded(7));
    }

    function test_settle_zeroValue_reverts() public {
        vm.expectRevert(ConfidentialX402EscrowReceiver.ZeroAmount.selector);
        receiver.settle(9, _proofFor(0));
    }

    function test_settle_rateTruncation_encryptsScaledAmount() public {
        (ConfidentialX402EscrowReceiver r, MockConfidentialUsdc c, MockConfidentialEscrow e) = _deployWithRate(1000);
        euint64 funded = r.settle(11, _authFor(makeAddr("ratePayer"), 2500, keccak256("rate")));
        assertEq(c.wrapped(address(r)), 2000);
        expectPlaintext(funded, uint64(2));
        expectPlaintext(e.funded(11), uint64(2));
    }

    function test_settle_rateRoundsToZero_reverts() public {
        (ConfidentialX402EscrowReceiver r,,) = _deployWithRate(1000);
        vm.expectRevert(ConfidentialX402EscrowReceiver.ZeroAmount.selector);
        r.settle(12, _authFor(makeAddr("dustPayer"), 999, keccak256("dust")));
    }

    function _deployWithRate(uint256 rate_)
        internal
        returns (ConfidentialX402EscrowReceiver r, MockConfidentialUsdc c, MockConfidentialEscrow e)
    {
        MockUSDC u = new MockUSDC();
        c = new MockConfidentialUsdc(address(u), rate_);
        e = new MockConfidentialEscrow();
        r = new ConfidentialX402EscrowReceiver(address(u), address(c), address(e));
        u.mint(makeAddr("ratePayer"), 10_000_000);
        u.mint(makeAddr("dustPayer"), 10_000_000);
    }
}

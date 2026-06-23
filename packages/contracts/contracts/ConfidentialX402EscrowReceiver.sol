// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IConfidentialFundingSource} from "@reineira-os/rss/contracts/interfaces/IConfidentialFundingSource.sol";

interface IERC3009Receive {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
}

interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IConfidentialUsdcWrapper {
    function wrap(address to, uint256 amount) external;
    function rate() external view returns (uint256);
    function setOperator(address operator, uint48 until) external;
}

interface IConfidentialEscrowFund {
    function fundFrom(uint256 escrowId, euint64 amount) external;
}

/// @title ConfidentialX402EscrowReceiver
/// @notice Confidential x402 funding source. Pulls USDC via EIP-3009 `receiveWithAuthorization`,
///         wraps it into ConfidentialUSDC, and funds a confidential escrow with the encrypted
///         amount. Implements the RSS {IConfidentialFundingSource} profile — `settle` returns an
///         encrypted handle, never a plaintext amount.
contract ConfidentialX402EscrowReceiver is IConfidentialFundingSource {
    address public immutable usdc;
    address public immutable confidentialUsdc;
    address public immutable escrow;

    struct PaymentAuthorization {
        address from;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        bytes32 salt;
        bytes signature;
    }

    error ZeroAmount();

    constructor(address usdc_, address confidentialUsdc_, address escrow_) {
        usdc = usdc_;
        confidentialUsdc = confidentialUsdc_;
        escrow = escrow_;
        IERC20Approve(usdc_).approve(confidentialUsdc_, type(uint256).max);
        IConfidentialUsdcWrapper(confidentialUsdc_).setOperator(escrow_, type(uint48).max);
    }

    function settle(uint256 escrowId, bytes calldata fundingProof) external override returns (euint64) {
        PaymentAuthorization memory a = abi.decode(fundingProof, (PaymentAuthorization));

        IERC3009Receive(usdc)
            .receiveWithAuthorization(a.from, address(this), a.value, a.validAfter, a.validBefore, a.nonce, a.signature);

        uint256 rate = IConfidentialUsdcWrapper(confidentialUsdc).rate();
        uint256 amountToWrap = a.value - (a.value % rate);
        if (amountToWrap == 0) revert ZeroAmount();
        IConfidentialUsdcWrapper(confidentialUsdc).wrap(address(this), amountToWrap);

        euint64 encryptedAmount = FHE.asEuint64(SafeCast.toUint64(amountToWrap / rate));
        FHE.allowTransient(encryptedAmount, escrow);
        IConfidentialEscrowFund(escrow).fundFrom(escrowId, encryptedAmount);

        return encryptedAmount;
    }
}

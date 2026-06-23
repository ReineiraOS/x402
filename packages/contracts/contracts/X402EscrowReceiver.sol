// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFundingSource} from "@reineira-os/rss/contracts/interfaces/IFundingSource.sol";

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

interface IEscrowFund {
    function fund(uint256 escrowId, uint256 amount) external;
}

/// @title X402EscrowReceiver
/// @notice x402 funding source: pulls USDC via EIP-3009 `receiveWithAuthorization` (to this
///         contract), then funds the escrow with the pulled amount. The bytes-signature overload
///         supports both EOA (ECDSA) and contract-wallet (ERC-1271) payers.
contract X402EscrowReceiver is IFundingSource {
    address public immutable usdc;
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

    constructor(address usdc_, address escrow_) {
        usdc = usdc_;
        escrow = escrow_;
    }

    function settle(uint256 escrowId, bytes calldata fundingProof) external override returns (uint256) {
        PaymentAuthorization memory a = abi.decode(fundingProof, (PaymentAuthorization));

        IERC3009Receive(usdc)
            .receiveWithAuthorization(a.from, address(this), a.value, a.validAfter, a.validBefore, a.nonce, a.signature);

        IERC20Approve(usdc).approve(escrow, a.value);
        IEscrowFund(escrow).fund(escrowId, a.value);

        return a.value;
    }
}

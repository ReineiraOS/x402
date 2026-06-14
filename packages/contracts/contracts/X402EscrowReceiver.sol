// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEscrow} from "@reineira-os/rss/contracts/interfaces/IEscrow.sol";
import {IFundingSource} from "@reineira-os/rss/contracts/interfaces/IFundingSource.sol";

/// @title X402EscrowReceiver — NON-DEPLOYED SCAFFOLD
/// @notice Interface-only stub for the planned x402 funding source. `settle` is intentionally
///         unimplemented and always reverts; this contract is not deployed and carries no value.
///         The intended flow is: pull USDC via EIP-3009 `receiveWithAuthorization`, then call
///         `escrow.fund(escrowId, fundingProof)`. Implement before any on-chain use.
contract X402EscrowReceiver is IFundingSource {
    address public immutable usdc;
    IEscrow public immutable escrow;

    error NotImplemented();

    constructor(address usdc_, address escrow_) {
        usdc = usdc_;
        escrow = IEscrow(escrow_);
    }

    function settle(uint256, bytes calldata) external pure override returns (uint256) {
        revert NotImplemented();
    }
}

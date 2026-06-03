// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEscrow} from "@reineira-os/rss/contracts/interfaces/IEscrow.sol";
import {IFundingSource} from "@reineira-os/rss/contracts/interfaces/IFundingSource.sol";

contract X402EscrowReceiver is IFundingSource {
    address public immutable usdc;
    IEscrow public immutable escrow;

    error NotImplemented();

    constructor(address usdc_, address escrow_) {
        usdc = usdc_;
        escrow = IEscrow(escrow_);
    }

    // Scaffold stub — settle() implemented in A3 (DEV-191): pull USDC via
    // receiveWithAuthorization, then escrow.fund(escrowId, abi.encode(amount)).
    function settle(uint256, bytes calldata) external pure override returns (uint256) {
        revert NotImplemented();
    }
}

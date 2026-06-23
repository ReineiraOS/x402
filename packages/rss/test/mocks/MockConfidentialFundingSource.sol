// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IConfidentialFundingSource} from "../../contracts/interfaces/IConfidentialFundingSource.sol";

interface IConfidentialEscrowFund {
    function fundFrom(uint256 escrowId, euint64 amount) external;
}

contract MockConfidentialFundingSource is IConfidentialFundingSource {
    address public immutable escrow;

    constructor(address escrow_) {
        escrow = escrow_;
    }

    function settle(uint256 escrowId, bytes calldata fundingProof) external override returns (euint64) {
        uint64 value = abi.decode(fundingProof, (uint64));
        euint64 amount = FHE.asEuint64(value);
        FHE.allowTransient(amount, escrow);
        IConfidentialEscrowFund(escrow).fundFrom(escrowId, amount);
        return amount;
    }
}

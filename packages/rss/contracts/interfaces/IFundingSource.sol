// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFundingSource {
    function settle(uint256 escrowId, bytes calldata fundingProof) external returns (uint256 amount);
}

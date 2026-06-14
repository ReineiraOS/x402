// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEscrow {
    enum Phase {
        Open,
        Funded,
        Released,
        Refunded,
        Disputed
    }

    function fund(uint256 escrowId, bytes calldata fundingProof) external;

    function isFunded(uint256 escrowId) external view returns (bool);

    function status(uint256 escrowId) external view returns (Phase);

    function exists(uint256 escrowId) external view returns (bool);
}

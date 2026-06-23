// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract MockConfidentialEscrow {
    mapping(uint256 => euint64) public funded;
    mapping(uint256 => bool) public wasFunded;

    function fundFrom(uint256 escrowId, euint64 amount) external {
        funded[escrowId] = amount;
        wasFunded[escrowId] = true;
    }
}

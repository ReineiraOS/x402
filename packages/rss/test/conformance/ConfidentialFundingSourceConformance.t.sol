// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {CofheTest} from "@cofhe/foundry-plugin/contracts/CofheTest.sol";
import {euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IConfidentialFundingSource} from "../../contracts/interfaces/IConfidentialFundingSource.sol";

abstract contract ConfidentialFundingSourceConformance is CofheTest {
    IConfidentialFundingSource internal fundingSource;
    uint256 internal escrowId;

    function _deploy() internal virtual returns (IConfidentialFundingSource fs, uint256 id);

    function _proofFor(uint64 amount) internal virtual returns (bytes memory);

    function _fundedAmount(uint256 id) internal virtual returns (euint64);

    function setUp() public virtual {
        deployMocks();
        (fundingSource, escrowId) = _deploy();
    }

    function test_conformance_settleFundsEscrowConfidentially() public {
        uint64 amount = 250_000;
        euint64 funded = fundingSource.settle(escrowId, _proofFor(amount));
        expectPlaintext(funded, amount);
        expectPlaintext(_fundedAmount(escrowId), amount);
    }

    function test_conformance_settleTracksProofAmount() public {
        uint64 first = 100_000;
        euint64 fundedFirst = fundingSource.settle(escrowId, _proofFor(first));
        expectPlaintext(fundedFirst, first);
        expectPlaintext(_fundedAmount(escrowId), first);

        uint64 second = 400_000;
        euint64 fundedSecond = fundingSource.settle(escrowId + 1, _proofFor(second));
        expectPlaintext(fundedSecond, second);
        expectPlaintext(_fundedAmount(escrowId + 1), second);
    }
}

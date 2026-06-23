// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ConfidentialFundingSourceConformance} from "./conformance/ConfidentialFundingSourceConformance.t.sol";
import {IConfidentialFundingSource} from "../contracts/interfaces/IConfidentialFundingSource.sol";
import {euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {MockConfidentialFundingSource} from "./mocks/MockConfidentialFundingSource.sol";
import {MockConfidentialEscrow} from "./mocks/MockConfidentialEscrow.sol";

contract ReferenceConfidentialFundingSourceTest is ConfidentialFundingSourceConformance {
    MockConfidentialEscrow internal mockEscrow;
    MockConfidentialFundingSource internal mockFs;

    function _deploy() internal override returns (IConfidentialFundingSource, uint256) {
        mockEscrow = new MockConfidentialEscrow();
        mockFs = new MockConfidentialFundingSource(address(mockEscrow));
        return (IConfidentialFundingSource(address(mockFs)), 1);
    }

    function _proofFor(uint64 amount) internal pure override returns (bytes memory) {
        return abi.encode(amount);
    }

    function _fundedAmount(uint256 id) internal view override returns (euint64) {
        return mockEscrow.funded(id);
    }
}

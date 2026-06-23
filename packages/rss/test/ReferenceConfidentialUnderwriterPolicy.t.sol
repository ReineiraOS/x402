// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ConfidentialUnderwriterPolicyConformance} from "./conformance/ConfidentialUnderwriterPolicyConformance.t.sol";
import {IConfidentialUnderwriterPolicy} from "../contracts/interfaces/IConfidentialUnderwriterPolicy.sol";
import {MockConfidentialUnderwriterPolicy} from "./mocks/MockConfidentialUnderwriterPolicy.sol";

contract ReferenceConfidentialUnderwriterPolicyTest is ConfidentialUnderwriterPolicyConformance {
    MockConfidentialUnderwriterPolicy internal mock;

    function _deploy() internal override returns (IConfidentialUnderwriterPolicy, uint256) {
        mock = new MockConfidentialUnderwriterPolicy();
        return (IConfidentialUnderwriterPolicy(address(mock)), 1);
    }

    function _bind() internal override {
        mock.onPolicySet(coverageId, "");
    }

    function _makeValid() internal override {
        mock.setValid(coverageId);
    }
}

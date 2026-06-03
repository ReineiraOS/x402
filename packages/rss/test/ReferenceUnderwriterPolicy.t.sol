// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {UnderwriterPolicyConformance} from "./conformance/UnderwriterPolicyConformance.t.sol";
import {IUnderwriterPolicy} from "../contracts/interfaces/IUnderwriterPolicy.sol";
import {MockUnderwriterPolicy} from "./mocks/MockUnderwriterPolicy.sol";

contract ReferenceUnderwriterPolicyTest is UnderwriterPolicyConformance {
    MockUnderwriterPolicy internal mock;

    function _deploy() internal override returns (IUnderwriterPolicy, uint256) {
        mock = new MockUnderwriterPolicy();
        return (IUnderwriterPolicy(address(mock)), 1);
    }

    function _bind() internal override {
        mock.onPolicySet(coverageId, "");
    }

    function _makeValid() internal override {
        mock.setValid(coverageId);
    }
}

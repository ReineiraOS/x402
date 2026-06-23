// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {CofheTest} from "@cofhe/foundry-plugin/contracts/CofheTest.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IConfidentialUnderwriterPolicy} from "../../contracts/interfaces/IConfidentialUnderwriterPolicy.sol";

abstract contract ConfidentialUnderwriterPolicyConformance is CofheTest {
    IConfidentialUnderwriterPolicy internal policy;
    uint256 internal coverageId;

    function _deploy() internal virtual returns (IConfidentialUnderwriterPolicy p, uint256 id);

    function _bind() internal virtual;

    function _makeValid() internal virtual;

    function setUp() public virtual {
        deployMocks();
        (policy, coverageId) = _deploy();
    }

    function test_conformance_supportsInterface() public view {
        assertTrue(policy.supportsInterface(type(IConfidentialUnderwriterPolicy).interfaceId));
        assertTrue(policy.supportsInterface(type(IERC165).interfaceId));
    }

    function test_conformance_judgeLifecycle() public {
        _bind();
        expectPlaintext(policy.judge(coverageId, ""), false);
        _makeValid();
        expectPlaintext(policy.judge(coverageId, ""), true);
    }

    function test_conformance_evaluateRiskReturnsEncrypted() public {
        expectPlaintext(policy.evaluateRisk(coverageId, ""), uint64(0));
    }
}

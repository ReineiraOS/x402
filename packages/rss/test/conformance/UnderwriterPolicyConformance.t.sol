// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IUnderwriterPolicy} from "../../contracts/interfaces/IUnderwriterPolicy.sol";

abstract contract UnderwriterPolicyConformance is Test {
    IUnderwriterPolicy internal policy;
    uint256 internal coverageId;

    function _deploy() internal virtual returns (IUnderwriterPolicy p, uint256 id);

    function _bind() internal virtual;

    function _makeValid() internal virtual;

    function setUp() public virtual {
        (policy, coverageId) = _deploy();
    }

    function test_conformance_supportsInterface() public view {
        assertTrue(policy.supportsInterface(type(IUnderwriterPolicy).interfaceId));
        assertTrue(policy.supportsInterface(type(IERC165).interfaceId));
    }

    function test_conformance_judgeLifecycle() public {
        _bind();
        assertFalse(policy.judge(coverageId, ""));
        _makeValid();
        assertTrue(policy.judge(coverageId, ""));
    }
}

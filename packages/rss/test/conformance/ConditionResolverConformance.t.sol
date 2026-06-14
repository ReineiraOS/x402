// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IConditionResolver} from "../../contracts/interfaces/IConditionResolver.sol";

abstract contract ConditionResolverConformance is Test {
    IConditionResolver internal resolver;
    uint256 internal escrowId;

    function _deploy() internal virtual returns (IConditionResolver r, uint256 id);

    function _configure() internal virtual;

    function _satisfy() internal virtual;

    function setUp() public virtual {
        (resolver, escrowId) = _deploy();
    }

    function test_conformance_supportsInterface() public view {
        assertTrue(resolver.supportsInterface(type(IConditionResolver).interfaceId));
        assertTrue(resolver.supportsInterface(type(IERC165).interfaceId));
    }

    function test_conformance_lifecycle() public {
        assertFalse(resolver.isConditionMet(escrowId));
        _configure();
        assertFalse(resolver.isConditionMet(escrowId));
        _satisfy();
        assertTrue(resolver.isConditionMet(escrowId));
    }

    function test_conformance_feeBounded() public view {
        (uint16 bps,) = resolver.getConditionFee(escrowId);
        assertLe(bps, 10_000);
    }
}

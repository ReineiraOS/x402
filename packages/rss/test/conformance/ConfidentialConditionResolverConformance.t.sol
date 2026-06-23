// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {CofheTest} from "@cofhe/foundry-plugin/contracts/CofheTest.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IConditionResolver} from "../../contracts/interfaces/IConditionResolver.sol";
import {IConfidentialConditionResolver} from "../../contracts/interfaces/IConfidentialConditionResolver.sol";

abstract contract ConfidentialConditionResolverConformance is CofheTest {
    IConfidentialConditionResolver internal resolver;
    uint256 internal escrowId;
    uint64 internal threshold;

    function _deploy() internal virtual returns (IConfidentialConditionResolver r, uint256 id, uint64 floor);

    function _configure() internal virtual;

    function _breach() internal virtual;

    function setUp() public virtual {
        deployMocks();
        (resolver, escrowId, threshold) = _deploy();
    }

    function test_conformance_supportsInterface() public view {
        assertTrue(resolver.supportsInterface(type(IConfidentialConditionResolver).interfaceId));
        assertTrue(resolver.supportsInterface(type(IConditionResolver).interfaceId));
        assertTrue(resolver.supportsInterface(type(IERC165).interfaceId));
    }

    function test_conformance_thresholdIsEncrypted() public {
        _configure();
        expectPlaintext(resolver.getEncryptedThreshold(escrowId), threshold);
    }

    function test_conformance_verdictLifecycle() public {
        _configure();
        assertFalse(resolver.isConditionMet(escrowId));
        _breach();
        assertTrue(resolver.isConditionMet(escrowId));
        assertFalse(resolver.isConditionMet(escrowId + 1));
    }

    function test_conformance_feeBounded() public {
        _configure();
        (uint16 bps,) = resolver.getConditionFee(escrowId);
        assertLe(bps, 10_000);
    }
}

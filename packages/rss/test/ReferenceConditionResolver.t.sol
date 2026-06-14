// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ConditionResolverConformance} from "./conformance/ConditionResolverConformance.t.sol";
import {IConditionResolver} from "../contracts/interfaces/IConditionResolver.sol";
import {MockConditionResolver} from "./mocks/MockConditionResolver.sol";

contract ReferenceConditionResolverTest is ConditionResolverConformance {
    MockConditionResolver internal mock;

    function _deploy() internal override returns (IConditionResolver, uint256) {
        mock = new MockConditionResolver();
        return (IConditionResolver(address(mock)), 1);
    }

    function _configure() internal override {
        mock.onConditionSet(escrowId, "");
    }

    function _satisfy() internal override {
        mock.markMet(escrowId);
    }
}

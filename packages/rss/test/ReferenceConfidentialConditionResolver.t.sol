// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ConfidentialConditionResolverConformance} from "./conformance/ConfidentialConditionResolverConformance.t.sol";
import {IConfidentialConditionResolver} from "../contracts/interfaces/IConfidentialConditionResolver.sol";
import {MockConfidentialConditionResolver} from "./mocks/MockConfidentialConditionResolver.sol";

contract ReferenceConfidentialConditionResolverTest is ConfidentialConditionResolverConformance {
    MockConfidentialConditionResolver internal mock;

    function _deploy() internal override returns (IConfidentialConditionResolver, uint256, uint64) {
        mock = new MockConfidentialConditionResolver();
        return (IConfidentialConditionResolver(address(mock)), 1, 1_000_000);
    }

    function _configure() internal override {
        mock.onConditionSet(escrowId, abi.encode(threshold));
    }

    function _breach() internal override {
        mock.latchBreach(escrowId, true);
    }
}

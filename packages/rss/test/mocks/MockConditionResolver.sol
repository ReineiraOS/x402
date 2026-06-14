// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IConditionResolver} from "../../contracts/interfaces/IConditionResolver.sol";

contract MockConditionResolver is IConditionResolver, ERC165 {
    mapping(uint256 => bool) public configured;
    mapping(uint256 => bool) private _met;

    function onConditionSet(uint256 escrowId, bytes calldata) external override {
        configured[escrowId] = true;
    }

    function markMet(uint256 escrowId) external {
        _met[escrowId] = true;
    }

    function isConditionMet(uint256 escrowId) external view override returns (bool) {
        return _met[escrowId];
    }

    function getConditionFee(uint256) external pure override returns (uint16, address) {
        return (0, address(0));
    }

    function supportsInterface(bytes4 id) public view override(ERC165, IERC165) returns (bool) {
        return id == type(IConditionResolver).interfaceId || super.supportsInterface(id);
    }
}

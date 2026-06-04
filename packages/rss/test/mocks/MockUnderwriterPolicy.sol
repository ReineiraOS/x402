// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IUnderwriterPolicy} from "../../contracts/interfaces/IUnderwriterPolicy.sol";

contract MockUnderwriterPolicy is IUnderwriterPolicy, ERC165 {
    mapping(uint256 => bool) public bound;
    mapping(uint256 => bool) private _valid;

    function onPolicySet(uint256 coverageId, bytes calldata) external override {
        bound[coverageId] = true;
    }

    function evaluateRisk(uint256, bytes calldata) external pure override returns (uint256) {
        return 0;
    }

    function setValid(uint256 coverageId) external {
        _valid[coverageId] = true;
    }

    function judge(uint256 coverageId, bytes calldata) external view override returns (bool) {
        return _valid[coverageId];
    }

    function supportsInterface(bytes4 id) public view override(ERC165, IERC165) returns (bool) {
        return id == type(IUnderwriterPolicy).interfaceId || super.supportsInterface(id);
    }
}

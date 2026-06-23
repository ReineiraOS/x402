// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {FHE, euint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IConfidentialUnderwriterPolicy} from "../../contracts/interfaces/IConfidentialUnderwriterPolicy.sol";

contract MockConfidentialUnderwriterPolicy is IConfidentialUnderwriterPolicy, ERC165 {
    mapping(uint256 => bool) public bound;
    mapping(uint256 => bool) private _valid;

    function onPolicySet(uint256 coverageId, bytes calldata) external override {
        bound[coverageId] = true;
    }

    function evaluateRisk(uint256, bytes calldata) external override returns (euint64) {
        return FHE.asEuint64(uint64(0));
    }

    function setValid(uint256 coverageId) external {
        _valid[coverageId] = true;
    }

    function judge(uint256 coverageId, bytes calldata) external override returns (ebool) {
        return FHE.asEbool(_valid[coverageId]);
    }

    function supportsInterface(bytes4 id) public view override(ERC165, IERC165) returns (bool) {
        return id == type(IConfidentialUnderwriterPolicy).interfaceId || super.supportsInterface(id);
    }
}

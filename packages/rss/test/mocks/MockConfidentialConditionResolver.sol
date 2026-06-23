// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {FHE, euint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IConditionResolver} from "../../contracts/interfaces/IConditionResolver.sol";
import {IConfidentialConditionResolver} from "../../contracts/interfaces/IConfidentialConditionResolver.sol";

contract MockConfidentialConditionResolver is IConfidentialConditionResolver, ERC165 {
    mapping(uint256 => euint64) private _threshold;
    mapping(uint256 => bool) private _configured;
    mapping(uint256 => bool) private _breached;

    function onConditionSet(uint256 escrowId, bytes calldata data) external override {
        uint64 floor = abi.decode(data, (uint64));
        _threshold[escrowId] = FHE.asEuint64(floor);
        _configured[escrowId] = true;
    }

    function latchBreach(uint256 escrowId, bool breached) external {
        _breached[escrowId] = breached;
    }

    function isConditionMet(uint256 escrowId) external view override returns (bool) {
        return _breached[escrowId];
    }

    function getEncryptedThreshold(uint256 escrowId) external view override returns (euint64) {
        return _threshold[escrowId];
    }

    function getConditionFee(uint256) external pure override returns (uint16, address) {
        return (0, address(0));
    }

    function supportsInterface(bytes4 id) public view override(ERC165, IERC165) returns (bool) {
        return id == type(IConfidentialConditionResolver).interfaceId || id == type(IConditionResolver).interfaceId
            || super.supportsInterface(id);
    }
}

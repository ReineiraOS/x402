// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IUnderwriterPolicy} from "@reineira-os/rss/contracts/interfaces/IUnderwriterPolicy.sol";

interface IBreachOracle {
    function isBreached(uint256 escrowId) external view returns (bool);
}

contract DeliveryPolicy is IUnderwriterPolicy, ERC165 {
    struct Binding {
        address resolver;
        uint256 escrowId;
        bool configured;
    }

    address public immutable coverageManager;

    mapping(uint256 => Binding) private _bindings;

    event PolicyBound(uint256 indexed coverageId, address resolver, uint256 escrowId);

    error InvalidCoverageManager();
    error NotCoverageManager();
    error AlreadyBound(uint256 coverageId);
    error NotBound(uint256 coverageId);
    error InvalidResolver();

    constructor(address coverageManager_) {
        if (coverageManager_ == address(0)) revert InvalidCoverageManager();
        coverageManager = coverageManager_;
    }

    function onPolicySet(uint256 coverageId, bytes calldata data) external override {
        if (msg.sender != coverageManager) revert NotCoverageManager();
        Binding storage binding = _bindings[coverageId];
        if (binding.configured) revert AlreadyBound(coverageId);

        (address resolver, uint256 escrowId) = abi.decode(data, (address, uint256));
        if (resolver == address(0)) revert InvalidResolver();

        binding.resolver = resolver;
        binding.escrowId = escrowId;
        binding.configured = true;

        emit PolicyBound(coverageId, resolver, escrowId);
    }

    function evaluateRisk(uint256, bytes calldata) external view override returns (uint256 riskScore) {
        if (msg.sender != coverageManager) revert NotCoverageManager();
        return 0;
    }

    function judge(uint256 coverageId, bytes calldata) external view override returns (bool valid) {
        Binding storage binding = _bindings[coverageId];
        if (!binding.configured) revert NotBound(coverageId);
        return IBreachOracle(binding.resolver).isBreached(binding.escrowId);
    }

    function resolverOf(uint256 coverageId) external view returns (address) {
        return _bindings[coverageId].resolver;
    }

    function escrowIdOf(uint256 coverageId) external view returns (uint256) {
        return _bindings[coverageId].escrowId;
    }

    function isBound(uint256 coverageId) external view returns (bool) {
        return _bindings[coverageId].configured;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IUnderwriterPolicy).interfaceId || super.supportsInterface(interfaceId);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {FHE, euint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IConfidentialUnderwriterPolicy} from "@reineira-os/rss/contracts/interfaces/IConfidentialUnderwriterPolicy.sol";

interface IBreachOracle {
    function isBreached(uint256 escrowId) external view returns (bool);
}

/// @title ConfidentialDeliveryPolicy
/// @notice Confidential underwriter policy for the insured data-buy flow. Binds each coverage to
///         an escrow + a breach oracle (resolver), then judges a dispute by wrapping the resolver's
///         plaintext breach verdict into an encrypted `ebool`. Risk score and verdict are encrypted
///         so the coverage manager can branch without revealing them. Implements the RSS
///         {IConfidentialUnderwriterPolicy} profile.
contract ConfidentialDeliveryPolicy is IConfidentialUnderwriterPolicy, ERC165 {
    struct Binding {
        uint256 escrowId;
        bool configured;
    }

    address public immutable coverageManager;
    address public immutable resolver;

    mapping(uint256 => Binding) private _bindings;

    event PolicyBound(uint256 indexed coverageId, address resolver, uint256 escrowId);

    error InvalidCoverageManager();
    error InvalidResolver();
    error NotCoverageManager();
    error AlreadyBound(uint256 coverageId);
    error NotBound(uint256 coverageId);

    constructor(address coverageManager_, address resolver_) {
        if (coverageManager_ == address(0)) revert InvalidCoverageManager();
        if (resolver_ == address(0)) revert InvalidResolver();
        coverageManager = coverageManager_;
        resolver = resolver_;
    }

    function onPolicySet(uint256 coverageId, bytes calldata data) external override {
        if (msg.sender != coverageManager) revert NotCoverageManager();
        Binding storage binding = _bindings[coverageId];
        if (binding.configured) revert AlreadyBound(coverageId);

        uint256 escrowId = abi.decode(data, (uint256));
        binding.escrowId = escrowId;
        binding.configured = true;

        emit PolicyBound(coverageId, resolver, escrowId);
    }

    function evaluateRisk(uint256, bytes calldata) external override returns (euint64 riskScore) {
        if (msg.sender != coverageManager) revert NotCoverageManager();
        riskScore = FHE.asEuint64(0);
        FHE.allowTransient(riskScore, msg.sender);
    }

    function judge(uint256 coverageId, bytes calldata) external override returns (ebool valid) {
        if (msg.sender != coverageManager) revert NotCoverageManager();
        Binding storage binding = _bindings[coverageId];
        if (!binding.configured) revert NotBound(coverageId);
        valid = FHE.asEbool(IBreachOracle(resolver).isBreached(binding.escrowId));
        FHE.allowTransient(valid, msg.sender);
    }

    function resolverOf(uint256 coverageId) external view returns (address) {
        return _bindings[coverageId].configured ? resolver : address(0);
    }

    function escrowIdOf(uint256 coverageId) external view returns (uint256) {
        return _bindings[coverageId].escrowId;
    }

    function isBound(uint256 coverageId) external view returns (bool) {
        return _bindings[coverageId].configured;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IConfidentialUnderwriterPolicy).interfaceId || super.supportsInterface(interfaceId);
    }
}

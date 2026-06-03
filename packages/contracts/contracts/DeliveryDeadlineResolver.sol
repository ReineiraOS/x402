// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IConditionResolver} from "@reineira-os/rss/contracts/interfaces/IConditionResolver.sol";

contract DeliveryDeadlineResolver is IConditionResolver, ERC165 {
    struct Condition {
        uint64 deadline;
        address attester;
        bool configured;
        bool delivered;
    }

    address public immutable escrow;

    mapping(uint256 => Condition) private _conditions;

    event ConditionConfigured(uint256 indexed escrowId, uint64 deadline, address attester);
    event DeliveryAttested(uint256 indexed escrowId, uint64 attestedAt);

    error InvalidEscrow();
    error NotEscrow();
    error AlreadyConfigured(uint256 escrowId);
    error NotConfigured(uint256 escrowId);
    error InvalidDeadline();
    error InvalidAttester();
    error NotAttester();
    error AttestationWindowClosed(uint256 escrowId);

    constructor(address escrow_) {
        if (escrow_ == address(0)) revert InvalidEscrow();
        escrow = escrow_;
    }

    function onConditionSet(uint256 escrowId, bytes calldata data) external override {
        if (msg.sender != escrow) revert NotEscrow();
        Condition storage condition = _conditions[escrowId];
        if (condition.configured) revert AlreadyConfigured(escrowId);

        (uint256 deadline, address attester) = abi.decode(data, (uint256, address));
        if (deadline <= block.timestamp || deadline > type(uint64).max) revert InvalidDeadline();
        if (attester == address(0)) revert InvalidAttester();

        // deadline is bound-checked against type(uint64).max above
        // forge-lint: disable-next-line(unsafe-typecast)
        condition.deadline = uint64(deadline);
        condition.attester = attester;
        condition.configured = true;

        // forge-lint: disable-next-line(unsafe-typecast)
        emit ConditionConfigured(escrowId, uint64(deadline), attester);
    }

    function attestDelivery(uint256 escrowId) external {
        Condition storage condition = _conditions[escrowId];
        if (!condition.configured) revert NotConfigured(escrowId);
        if (msg.sender != condition.attester) revert NotAttester();
        if (block.timestamp > condition.deadline) revert AttestationWindowClosed(escrowId);

        condition.delivered = true;

        emit DeliveryAttested(escrowId, uint64(block.timestamp));
    }

    function isConditionMet(uint256 escrowId) external view override returns (bool) {
        return _conditions[escrowId].delivered;
    }

    function isBreached(uint256 escrowId) external view returns (bool) {
        Condition storage condition = _conditions[escrowId];
        return condition.configured && !condition.delivered && block.timestamp > condition.deadline;
    }

    function getConditionFee(uint256) external pure override returns (uint16 bps, address recipient) {
        return (0, address(0));
    }

    function deadlineOf(uint256 escrowId) external view returns (uint64) {
        return _conditions[escrowId].deadline;
    }

    function attesterOf(uint256 escrowId) external view returns (address) {
        return _conditions[escrowId].attester;
    }

    function isDelivered(uint256 escrowId) external view returns (bool) {
        return _conditions[escrowId].delivered;
    }

    function isConfigured(uint256 escrowId) external view returns (bool) {
        return _conditions[escrowId].configured;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IConditionResolver).interfaceId || super.supportsInterface(interfaceId);
    }
}

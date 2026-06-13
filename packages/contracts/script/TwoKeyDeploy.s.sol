// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {ProtectedVault} from "../contracts/ProtectedVault.sol";
import {AlertResolver} from "../contracts/AlertResolver.sol";

/// @notice Deploys the Two-Key Halt showcase pair: a ProtectedVault (PAUSER_ROLE -> the distinct
///         Guardian key, DEMO_ROLE -> the deployer/staged-attacker) and an AlertResolver bound to
///         the existing plain Escrow and the vault. Seeds the vault so `recordedFloor` is set.
contract TwoKeyDeploy is Script {
    function run() external {
        address escrow = vm.envAddress("ESCROW_ADDRESS");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        uint256 seed = vm.envOr("VAULT_SEED", uint256(1_000_000));

        vm.startBroadcast();
        ProtectedVault vault = new ProtectedVault(deployer, guardian, deployer);
        vault.deposit(seed);
        AlertResolver resolver = new AlertResolver(escrow, address(vault));
        vm.stopBroadcast();

        console.log("VAULT_ADDRESS=%s", address(vault));
        console.log("ALERT_RESOLVER_ADDRESS=%s", address(resolver));
        console.log("VAULT_FLOOR=%s", vault.recordedFloor());
    }
}

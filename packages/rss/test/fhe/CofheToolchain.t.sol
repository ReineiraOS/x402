// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {CofheTest} from "@cofhe/foundry-plugin/contracts/CofheTest.sol";
import {FHE, euint64, ebool} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract CofheToolchainTest is CofheTest {
    function setUp() public {
        deployMocks();
    }

    function test_mockCoprocessor_encryptsAndDecrypts() public {
        euint64 amount = FHE.asEuint64(uint64(250_000));
        expectPlaintext(amount, uint64(250_000));

        ebool flag = FHE.asEbool(true);
        expectPlaintext(flag, true);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IValidatorRegistry} from "./IValidatorRegistry.sol";

/**
 * @title ValidatorRegistryOpen
 * @notice IValidatorRegistry implementation without whitelist: every address is treated as a validator.
 *         For testnet use only. On production use ValidatorRegistry with whitelist (ADMIN_ROLE).
 *         The "one validator per address" limit is enforced in Staking (operatorToValidatorId).
 */
contract ValidatorRegistryOpen is IValidatorRegistry {
    function isValidator(address) external pure override returns (bool) {
        return true;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ValidatorRegistry
 * @notice Validator whitelist - only admin-approved addresses may register as a validator in StakingContract.
 */
contract ValidatorRegistry is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    struct ValidatorApproval {
        bool approved;
    }

    mapping(address => ValidatorApproval) public validators;

    event ValidatorApproved(address indexed validator);
    event ValidatorRemoved(address indexed validator);

    error ZeroAddress();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    function approveValidator(address validator) external onlyRole(ADMIN_ROLE) {
        if (validator == address(0)) revert ZeroAddress();
        validators[validator] = ValidatorApproval({approved: true});
        emit ValidatorApproved(validator);
    }

    function removeValidator(address validator) external onlyRole(ADMIN_ROLE) {
        validators[validator] = ValidatorApproval({approved: false});
        emit ValidatorRemoved(validator);
    }

    function isValidator(address account) external view returns (bool) {
        return validators[account].approved;
    }
}

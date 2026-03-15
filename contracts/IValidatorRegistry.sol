// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IValidatorRegistry {
    function isValidator(address account) external view returns (bool);
}

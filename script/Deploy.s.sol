// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ValidatorRegistry} from "../contracts/ValidatorRegistry.sol";
import {Staking} from "../contracts/Staking.sol";
import {RewardsTreasury} from "../contracts/RewardsTreasury.sol";

/**
 * Full system deploy: ValidatorRegistry -> Staking -> RewardsTreasury.
 * Env: DEPLOYER_PRIVATE_KEY, STAKING_TOKEN, REWARD_TOKEN (may be same as STAKING_TOKEN).
 * After deploy: approve validators (registry.approveValidator), fund treasury (depositRewards), set minBalanceForAlert (30 days).
 */
contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address stakingToken = vm.envAddress("STAKING_TOKEN");
        address rewardToken = vm.envOr("REWARD_TOKEN", stakingToken);
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        ValidatorRegistry registry = new ValidatorRegistry(deployer);
        Staking staking = new Staking(stakingToken, rewardToken, address(registry), deployer);
        RewardsTreasury treasury = new RewardsTreasury(rewardToken, deployer);

        registry.grantRole(registry.ADMIN_ROLE(), deployer);
        staking.grantRole(staking.ADMIN_ROLE(), deployer);
        treasury.grantRole(treasury.ADMIN_ROLE(), deployer);

        staking.setRewardsTreasury(address(treasury));
        treasury.setStakingContract(address(staking));

        vm.stopBroadcast();

        console.log("ValidatorRegistry:", address(registry));
        console.log("Staking:", address(staking));
        console.log("RewardsTreasury:", address(treasury));
        console.log("---");
        console.log("Next: registry.approveValidator(addr), treasury.depositRewards(amt), treasury.setMinBalanceForAlert(amt30d)");
    }
}

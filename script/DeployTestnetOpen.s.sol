// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ValidatorRegistryOpen} from "../contracts/ValidatorRegistryOpen.sol";
import {Staking} from "../contracts/Staking.sol";
import {RewardsTreasury} from "../contracts/RewardsTreasury.sol";

/**
 * Testnet deploy without whitelist: ValidatorRegistryOpen (anyone can be a validator) + Staking.
 * Connects to existing Treasury. Env: DEPLOYER_PRIVATE_KEY, STAKING_TOKEN, REWARD_TOKEN, REWARDS_TREASURY.
 * After deploy: treasury.depositRewards(...), claimReward(1) after first registration (sync rewardRate).
 */
contract DeployTestnetOpen is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address stakingToken = vm.envAddress("STAKING_TOKEN");
        address rewardToken = vm.envOr("REWARD_TOKEN", stakingToken);
        address treasuryAddr = vm.envAddress("REWARDS_TREASURY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        ValidatorRegistryOpen registry = new ValidatorRegistryOpen();
        Staking staking = new Staking(stakingToken, rewardToken, address(registry), deployer);

        staking.grantRole(staking.ADMIN_ROLE(), deployer);

        staking.setRewardsTreasury(treasuryAddr);
        RewardsTreasury(treasuryAddr).setStakingContract(address(staking));

        vm.stopBroadcast();

        console.log("ValidatorRegistryOpen:", address(registry));
        console.log("Staking:", address(staking));
        console.log("---");
        console.log("Treasury (existing):", treasuryAddr);
        console.log("Next: treasury.depositRewards(amt) if needed; after first validator registers, call staking.claimReward(1) to sync rewardRate.");
    }
}

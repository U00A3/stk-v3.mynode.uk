// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ValidatorRegistry} from "../contracts/ValidatorRegistry.sol";
import {Staking} from "../contracts/Staking.sol";
import {RewardsTreasury} from "../contracts/RewardsTreasury.sol";
import {MockERC20} from "../contracts/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract StakingTest is Test {
    ValidatorRegistry public registry;
    Staking public staking;
    RewardsTreasury public treasury;
    MockERC20 public stakingToken;
    MockERC20 public rewardToken;

    address public admin = address(1);
    address public validatorOp = address(2);
    address public alice = address(3);
    address public bob = address(4);

    function setUp() public {
        stakingToken = new MockERC20("Stake", "STK");
        rewardToken = new MockERC20("Reward", "RWD");

        registry = new ValidatorRegistry(admin);
        staking = new Staking(
            address(stakingToken),
            address(rewardToken),
            address(registry),
            admin
        );
        treasury = new RewardsTreasury(address(rewardToken), admin);

        vm.startPrank(admin);
        staking.setRewardsTreasury(address(treasury));
        staking.setMinSelfStake(100e18);
        staking.setSaturationBps(10000); // 100% in tests (limit disabled), individual tests set lower
        treasury.setStakingContract(address(staking));
        registry.approveValidator(validatorOp);
        vm.stopPrank();

        stakingToken.mint(validatorOp, 1_000_000e18);
        stakingToken.mint(alice, 1_000_000e18);
        stakingToken.mint(bob, 1_000_000e18);
        rewardToken.mint(address(treasury), 1_000_000e18);
    }

    function test_RegisterValidatorAndStake() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(1000, 100e18); // 10% commission, 100 self stake
        assertEq(staking.operatorToValidatorId(validatorOp), 1);
        assertEq(staking.getValidator(1).totalStake, 100e18);
        assertEq(staking.totalStaked(), 100e18);
        vm.stopPrank();

        vm.prank(alice);
        stakingToken.approve(address(staking), 200e18);
        vm.prank(alice);
        staking.stake(1, 200e18);
        (uint256 amt,) = staking.delegations(alice, 1);
        assertEq(amt, 200e18);
        assertEq(staking.getValidator(1).totalStake, 300e18);
        assertEq(staking.totalStaked(), 300e18);
    }

    function test_SaturationBlocksExcessStake() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(0, 100e18);
        vm.stopPrank();
        vm.prank(admin);
        registry.approveValidator(bob);
        vm.prank(bob);
        stakingToken.approve(address(staking), 100e18);
        vm.prank(bob);
        staking.registerValidator(0, 100e18);
        assertEq(staking.totalStaked(), 200e18);

        vm.prank(admin);
        staking.setSaturationBps(500); // 5% => cap = 10e18

        uint256 cap = staking.getSaturationCap();
        assertEq(cap, 10e18);

        vm.startPrank(alice);
        stakingToken.approve(address(staking), 100e18);
        staking.stake(1, 10e18);

        vm.expectRevert(Staking.SaturationExceeded.selector);
        staking.stake(1, 1e18);
        vm.stopPrank();
    }

    function test_SaturationExcludesSelfStake() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(0, 100e18);
        vm.stopPrank();

        vm.prank(admin);
        staking.setSaturationBps(500); // 5%

        (uint256 delegated, uint256 cap) = staking.getSaturationForValidator(1);
        assertEq(delegated, 0, "self-stake should not count as delegation");
        assertTrue(cap > 0);

        vm.startPrank(alice);
        stakingToken.approve(address(staking), 10e18);
        staking.stake(1, 5e18);
        vm.stopPrank();

        (delegated,) = staking.getSaturationForValidator(1);
        assertEq(delegated, 5e18, "only delegation counted");
    }

    function test_UnstakeAndWithdrawAfterDelay() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(0, 100e18);
        vm.stopPrank();

        vm.prank(alice);
        stakingToken.approve(address(staking), 50e18);
        vm.prank(alice);
        staking.stake(1, 50e18);

        vm.prank(alice);
        staking.unstake(1, 50e18);
        assertEq(staking.pendingUnstakeAmount(alice, 1), 50e18);
        (uint256 amtUnstake,) = staking.delegations(alice, 1);
        assertEq(amtUnstake, 0);

        vm.warp(block.timestamp + 12 hours);
        vm.prank(alice);
        vm.expectRevert(Staking.WithdrawNotUnlocked.selector);
        staking.withdraw(1);

        vm.warp(block.timestamp + 12 hours); // total 24h
        uint256 aliceBefore = stakingToken.balanceOf(alice);
        vm.prank(alice);
        staking.withdraw(1);
        assertEq(stakingToken.balanceOf(alice), aliceBefore + 50e18);
        assertEq(staking.pendingUnstakeAmount(alice, 1), 0);
    }

    function test_Redelegate() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(0, 100e18);
        vm.stopPrank();

        vm.prank(admin);
        registry.approveValidator(bob);
        vm.prank(bob);
        stakingToken.approve(address(staking), 100e18);
        vm.prank(bob);
        staking.registerValidator(500, 100e18);

        vm.prank(alice);
        stakingToken.approve(address(staking), 100e18);
        vm.prank(alice);
        staking.stake(1, 100e18);

        vm.prank(alice);
        staking.redelegate(1, 2, 50e18);
        (uint256 a1,) = staking.delegations(alice, 1);
        (uint256 a2,) = staking.delegations(alice, 2);
        assertEq(a1, 50e18);
        assertEq(a2, 50e18);
        assertEq(staking.getValidator(1).totalStake, 150e18);
        assertEq(staking.getValidator(2).totalStake, 150e18);
    }

    function test_RemoveValidator_BlocksNewStakes() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(0, 100e18);
        vm.stopPrank();
        vm.prank(admin);
        registry.removeValidator(validatorOp);
        vm.prank(alice);
        stakingToken.approve(address(staking), 50e18);
        vm.prank(alice);
        vm.expectRevert(Staking.ValidatorNotActive.selector);
        staking.stake(1, 50e18);
    }

    function test_OnlyWhitelistedCanRegister() public {
        vm.prank(alice);
        stakingToken.approve(address(staking), 100e18);
        vm.prank(alice);
        vm.expectRevert(Staking.NotValidator.selector);
        staking.registerValidator(0, 100e18);
    }

    function test_SetAPR() public {
        vm.prank(admin);
        staking.setAPR(500); // 5%
        assertEq(staking.aprBps(), 500);
        vm.prank(admin);
        vm.expectRevert("APR out of range");
        staking.setAPR(200); // below MIN 3%
        vm.prank(admin);
        vm.expectRevert("APR out of range");
        staking.setAPR(1500); // above MAX 12%
    }

    function test_CommissionChangeDelay() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(1000, 100e18);
        staking.requestCommissionChange(1, 1500); // 15%
        vm.expectRevert(Staking.CommissionChangeNotReady.selector);
        staking.applyCommissionChange(1);
        vm.warp(block.timestamp + 7 days);
        staking.applyCommissionChange(1);
        assertEq(staking.getValidator(1).commissionBps, 1500);
        vm.stopPrank();
    }

    function test_MaxDelegatorsReached() public {
        vm.prank(admin);
        staking.setMaxDelegators(1); // only 1 delegator (operator already counts)
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(0, 100e18);
        vm.stopPrank();
        vm.prank(alice);
        stakingToken.approve(address(staking), 10e18);
        vm.prank(alice);
        vm.expectRevert(Staking.MaxDelegatorsReached.selector);
        staking.stake(1, 10e18);
    }

    function test_EmergencyWithdraw() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(0, 100e18);
        vm.stopPrank();
        vm.prank(alice);
        stakingToken.approve(address(staking), 50e18);
        vm.prank(alice);
        staking.stake(1, 50e18);
        vm.prank(admin);
        staking.pause();
        uint256 aliceBefore = stakingToken.balanceOf(alice);
        vm.prank(alice);
        staking.emergencyWithdraw(1);
        assertEq(stakingToken.balanceOf(alice), aliceBefore + 50e18);
        (uint256 amt,) = staking.delegations(alice, 1);
        assertEq(amt, 0);
        assertEq(staking.getValidator(1).totalStake, 100e18);
    }

    function test_MinSelfStakeEnforced() public {
        vm.prank(admin);
        registry.approveValidator(alice);
        vm.prank(alice);
        stakingToken.approve(address(staking), 50e18);
        vm.prank(alice);
        vm.expectRevert(Staking.SelfStakeTooLow.selector);
        staking.registerValidator(0, 50e18);
    }

    // ---- Fuzz tests ----

    function testFuzz_Stake(uint256 amount) public {
        vm.assume(amount >= 1e18 && amount <= 900e18);
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(500, 100e18);
        vm.stopPrank();

        vm.prank(alice);
        stakingToken.approve(address(staking), amount);
        vm.prank(alice);
        staking.stake(1, amount);

        (uint256 amt,) = staking.delegations(alice, 1);
        assertEq(amt, amount);
        assertEq(staking.getValidator(1).totalStake, 100e18 + amount);
        assertEq(staking.totalStaked(), 100e18 + amount);
    }

    function testFuzz_Unstake(uint256 amount) public {
        vm.assume(amount >= 1e18 && amount <= 500e18);
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(0, 100e18);
        vm.stopPrank();

        vm.prank(alice);
        stakingToken.approve(address(staking), 500e18);
        vm.prank(alice);
        staking.stake(1, 500e18);

        vm.prank(alice);
        staking.unstake(1, amount);

        assertEq(staking.pendingUnstakeAmount(alice, 1), amount);
        (uint256 amt,) = staking.delegations(alice, 1);
        assertEq(amt, 500e18 - amount);
        assertEq(staking.getValidator(1).totalStake, 100e18 + 500e18 - amount);
        assertEq(staking.totalStaked(), 100e18 + 500e18 - amount);
    }

    function testFuzz_Redelegate(uint256 amount) public {
        vm.assume(amount >= 1e18 && amount <= 200e18);
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(0, 100e18);
        vm.stopPrank();
        vm.prank(admin);
        registry.approveValidator(bob);
        vm.prank(bob);
        stakingToken.approve(address(staking), 100e18);
        vm.prank(bob);
        staking.registerValidator(0, 100e18);

        vm.prank(alice);
        stakingToken.approve(address(staking), 200e18);
        vm.prank(alice);
        staking.stake(1, 200e18);

        vm.prank(alice);
        staking.redelegate(1, 2, amount);

        (uint256 a1,) = staking.delegations(alice, 1);
        (uint256 a2,) = staking.delegations(alice, 2);
        assertEq(a1, 200e18 - amount);
        assertEq(a2, amount);
        assertEq(staking.getValidator(1).totalStake, 100e18 + 200e18 - amount);
        assertEq(staking.getValidator(2).totalStake, 100e18 + amount);
        assertEq(staking.totalStaked(), 400e18);
    }

    function testFuzz_SetSaturationBps(uint256 bps) public {
        vm.assume(bps >= 100 && bps <= 10000);
        vm.prank(admin);
        staking.setSaturationBps(bps);
        assertEq(staking.saturationBps(), bps);
    }

    function testFuzz_RegisterValidator_selfStakeAndCommission(uint256 selfStake, uint16 commissionBps) public {
        vm.assume(selfStake >= 100e18 && selfStake <= 500_000e18);
        vm.assume(commissionBps <= 2000);
        vm.prank(admin);
        registry.approveValidator(alice);
        vm.prank(alice);
        stakingToken.approve(address(staking), selfStake);
        vm.prank(alice);
        staking.registerValidator(commissionBps, selfStake);

        assertEq(staking.operatorToValidatorId(alice), 1);
        assertEq(staking.getValidator(1).selfStake, selfStake);
        assertEq(staking.getValidator(1).commissionBps, commissionBps);
        assertEq(staking.totalStaked(), selfStake);
    }

    /// Invariant: totalStaked equals sum of all validators' totalStake
    function test_Invariant_totalStakedEqualsSumOfValidatorStakes() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(0, 100e18);
        vm.stopPrank();

        vm.prank(admin);
        registry.approveValidator(bob);
        vm.prank(bob);
        stakingToken.approve(address(staking), 200e18);
        vm.prank(bob);
        staking.registerValidator(1000, 200e18);

        vm.prank(alice);
        stakingToken.approve(address(staking), 200e18);
        vm.prank(alice);
        staking.stake(1, 150e18);
        vm.prank(alice);
        staking.stake(2, 50e18);

        uint256 sumValidatorStake;
        for (uint256 id = 1; id <= staking.nextValidatorId(); id++) {
            sumValidatorStake += staking.getValidator(id).totalStake;
        }
        assertEq(staking.totalStaked(), sumValidatorStake, "totalStaked vs sum(validator.totalStake)");
    }

    function test_SetValidatorMeta() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(500, 100e18);

        staking.setValidatorMeta(1, Staking.ValidatorMeta(
            "My Node",
            "https://mynode.uk",
            "@mynode",
            "https://github.com/mynode",
            "node@mynode.uk",
            "t.me/mynode",
            "Fast and reliable validator",
            "https://mynode.uk/avatar.png"
        ));
        vm.stopPrank();

        Staking.ValidatorMeta memory meta = staking.getValidatorMeta(1);
        assertEq(meta.name, "My Node");
        assertEq(meta.website, "https://mynode.uk");
        assertEq(meta.twitter, "@mynode");
        assertEq(meta.github, "https://github.com/mynode");
        assertEq(meta.email, "node@mynode.uk");
        assertEq(meta.chat, "t.me/mynode");
        assertEq(meta.description, "Fast and reliable validator");
        assertEq(meta.avatarUrl, "https://mynode.uk/avatar.png");
    }

    function test_SetValidatorMeta_OnlyOperator() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(500, 100e18);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(Staking.NotValidatorOperator.selector);
        staking.setValidatorMeta(1, Staking.ValidatorMeta("Hacker", "", "", "", "", "", "", ""));
    }

    function test_SetValidatorMeta_Update() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(500, 100e18);

        staking.setValidatorMeta(1, Staking.ValidatorMeta("V1", "", "", "", "", "", "", ""));
        assertEq(staking.getValidatorMeta(1).name, "V1");

        staking.setValidatorMeta(1, Staking.ValidatorMeta("V2", "https://v2.com", "", "", "", "", "Updated", ""));
        Staking.ValidatorMeta memory meta = staking.getValidatorMeta(1);
        assertEq(meta.name, "V2");
        assertEq(meta.website, "https://v2.com");
        assertEq(meta.description, "Updated");
        vm.stopPrank();
    }

    function test_DeactivateValidator_ByOperator() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(500, 100e18);
        staking.setValidatorMeta(1, Staking.ValidatorMeta("Node1", "https://n.io", "", "", "", "", "desc", "https://av.png"));

        staking.deactivateValidator(1);
        vm.stopPrank();

        Staking.Validator memory v = staking.getValidator(1);
        assertFalse(v.active, "should be inactive");
        assertEq(staking.operatorToValidatorId(validatorOp), 0, "mapping should be cleared");

        Staking.ValidatorMeta memory meta = staking.getValidatorMeta(1);
        assertEq(meta.name, "", "meta name should be cleared");
        assertEq(meta.avatarUrl, "", "meta avatar should be cleared");
    }

    function test_DeactivateValidator_ByAdmin() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(500, 100e18);
        vm.stopPrank();

        vm.prank(admin);
        staking.deactivateValidator(1);

        assertFalse(staking.getValidator(1).active);
    }

    function test_DeactivateValidator_Unauthorized() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(500, 100e18);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(Staking.NotValidatorOperator.selector);
        staking.deactivateValidator(1);
    }

    function test_DeactivateValidator_BlocksNewStakes() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(500, 100e18);
        staking.deactivateValidator(1);
        vm.stopPrank();

        vm.prank(alice);
        stakingToken.approve(address(staking), 50e18);
        vm.prank(alice);
        vm.expectRevert(Staking.ValidatorNotActive.selector);
        staking.stake(1, 50e18);
    }

    function test_DeactivateValidator_ExistingDelegatorsCanUnstake() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(500, 100e18);
        vm.stopPrank();

        vm.prank(alice);
        stakingToken.approve(address(staking), 50e18);
        vm.prank(alice);
        staking.stake(1, 50e18);

        vm.prank(validatorOp);
        staking.deactivateValidator(1);

        vm.prank(alice);
        staking.unstake(1, 50e18);

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        staking.withdraw(1);
        assertEq(stakingToken.balanceOf(alice), 1_000_000e18, "alice should get her tokens back");
    }

    function test_DeactivateValidator_OperatorCanReRegister() public {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 200e18);
        staking.registerValidator(500, 100e18);
        staking.deactivateValidator(1);

        staking.registerValidator(300, 100e18);
        vm.stopPrank();

        assertEq(staking.operatorToValidatorId(validatorOp), 2, "should have new validator id");
        assertTrue(staking.getValidator(2).active);
    }

    // ==================== REWARD + UNSTAKE TESTS ====================

    function _setupValidatorAndStake(uint256 stakeAmount) internal {
        vm.startPrank(validatorOp);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(1000, 100e18); // 10% commission
        vm.stopPrank();

        vm.prank(alice);
        stakingToken.approve(address(staking), stakeAmount);
        vm.prank(alice);
        staking.stake(1, stakeAmount);
    }

    function test_PartialUnstake_AutoClaimsRewards() public {
        _setupValidatorAndStake(1000e18);

        vm.warp(block.timestamp + 30 days);

        (, , uint256 delegatorShareBefore) = staking.earned(alice, 1);
        assertTrue(delegatorShareBefore > 0, "should have accrued rewards");

        uint256 rewardBalBefore = rewardToken.balanceOf(alice);

        vm.prank(alice);
        staking.unstake(1, 500e18);

        uint256 rewardBalAfter = rewardToken.balanceOf(alice);
        assertTrue(rewardBalAfter > rewardBalBefore, "rewards should have been paid out on unstake");
        assertApproxEqRel(rewardBalAfter - rewardBalBefore, delegatorShareBefore, 0.01e18);
    }

    function test_FullUnstake_AutoClaimsRewards() public {
        _setupValidatorAndStake(1000e18);

        vm.warp(block.timestamp + 30 days);

        (, , uint256 delegatorShareBefore) = staking.earned(alice, 1);
        assertTrue(delegatorShareBefore > 0, "should have accrued rewards");

        uint256 rewardBalBefore = rewardToken.balanceOf(alice);

        vm.prank(alice);
        staking.unstake(1, 1000e18);

        uint256 rewardBalAfter = rewardToken.balanceOf(alice);
        assertTrue(rewardBalAfter > rewardBalBefore, "rewards should have been paid out on full unstake");
    }

    function test_PartialUnstake_RemainingStakeContinuesEarning() public {
        _setupValidatorAndStake(1000e18);

        vm.warp(block.timestamp + 30 days);

        vm.prank(alice);
        staking.unstake(1, 500e18);

        (,, uint256 earnedRightAfter) = staking.earned(alice, 1);
        assertEq(earnedRightAfter, 0, "earned should be 0 right after unstake (was just claimed)");

        vm.warp(block.timestamp + 30 days);

        (, , uint256 earnedLater) = staking.earned(alice, 1);
        assertTrue(earnedLater > 0, "remaining 500 should continue earning rewards");
    }

    function test_Stake_AdditionalAutoClaimsRewards() public {
        _setupValidatorAndStake(500e18);

        vm.warp(block.timestamp + 30 days);

        (, , uint256 delegatorShareBefore) = staking.earned(alice, 1);
        assertTrue(delegatorShareBefore > 0, "should have accrued rewards");

        uint256 rewardBalBefore = rewardToken.balanceOf(alice);

        vm.prank(alice);
        stakingToken.approve(address(staking), 500e18);
        vm.prank(alice);
        staking.stake(1, 500e18);

        uint256 rewardBalAfter = rewardToken.balanceOf(alice);
        assertTrue(rewardBalAfter > rewardBalBefore, "rewards should have been paid out on additional stake");
    }

    function test_Redelegate_AutoClaimsRewardsFromSource() public {
        vm.prank(admin);
        registry.approveValidator(bob);

        vm.startPrank(bob);
        stakingToken.approve(address(staking), 100e18);
        staking.registerValidator(500, 100e18);
        vm.stopPrank();

        _setupValidatorAndStake(500e18);

        vm.warp(block.timestamp + 30 days);

        (, , uint256 delegatorShareBefore) = staking.earned(alice, 1);
        assertTrue(delegatorShareBefore > 0, "should have accrued rewards before redelegate");

        uint256 rewardBalBefore = rewardToken.balanceOf(alice);

        vm.prank(alice);
        staking.redelegate(1, 2, 250e18);

        uint256 rewardBalAfter = rewardToken.balanceOf(alice);
        assertTrue(rewardBalAfter > rewardBalBefore, "rewards from source validator should have been claimed");
    }

    function test_ClaimReward_Explicit() public {
        _setupValidatorAndStake(1000e18);

        vm.warp(block.timestamp + 30 days);

        (, , uint256 delegatorShare) = staking.earned(alice, 1);
        assertTrue(delegatorShare > 0, "should have accrued rewards");

        uint256 rewardBalBefore = rewardToken.balanceOf(alice);

        vm.prank(alice);
        staking.claimReward(1);

        uint256 rewardBalAfter = rewardToken.balanceOf(alice);
        assertApproxEqRel(rewardBalAfter - rewardBalBefore, delegatorShare, 0.01e18);

        (, , uint256 earnedAfterClaim) = staking.earned(alice, 1);
        assertEq(earnedAfterClaim, 0, "earned should be 0 after claim");
    }

    function test_Commission_PaidToOperator() public {
        _setupValidatorAndStake(1000e18);

        vm.warp(block.timestamp + 30 days);

        (uint256 rawReward, uint256 commission, ) = staking.earned(alice, 1);
        assertTrue(rawReward > 0, "raw reward should be positive");
        assertTrue(commission > 0, "commission should be positive (10% set)");

        uint256 opBalBefore = rewardToken.balanceOf(validatorOp);

        vm.prank(alice);
        staking.claimReward(1);

        uint256 opBalAfter = rewardToken.balanceOf(validatorOp);
        assertTrue(opBalAfter > opBalBefore, "operator should receive commission");
    }
}

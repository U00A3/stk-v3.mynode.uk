// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title RewardsTreasury
 * @notice Holds reward tokens, funded by team; sends rewards to Staking; emits TreasuryLow when balance < 30 days runway.
 */
contract RewardsTreasury is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    IERC20 public immutable rewardToken;
    address public stakingContract;

    /// @dev If balance < minBalanceForAlert, we emit TreasuryLow (e.g. 30 days of rewards).
    uint256 public minBalanceForAlert;
    uint256 public constant SECONDS_PER_DAY = 86400;
    uint256 public constant MIN_RUNWAY_DAYS_FOR_ALERT = 30;

    event RewardsDeposited(address indexed by, uint256 amount);
    event SentToStaking(address indexed staking, uint256 amount);
    event TreasuryLow(uint256 balance);
    event StakingContractSet(address indexed staking);
    event MinBalanceForAlertSet(uint256 amount);
    event UnusedWithdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error OnlyStaking();
    error StakingNotSet();

    constructor(address _rewardToken, address admin) {
        if (_rewardToken == address(0) || admin == address(0)) revert ZeroAddress();
        rewardToken = IERC20(_rewardToken);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    function setStakingContract(address _staking) external onlyRole(ADMIN_ROLE) {
        stakingContract = _staking;
        emit StakingContractSet(_staking);
    }

    function setMinBalanceForAlert(uint256 _amount) external onlyRole(ADMIN_ROLE) {
        minBalanceForAlert = _amount;
        emit MinBalanceForAlertSet(_amount);
    }

    function depositRewards(uint256 amount) external onlyRole(ADMIN_ROLE) {
        if (amount == 0) return;
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        emit RewardsDeposited(msg.sender, amount);
    }

    /// @notice Called only by Staking contract on claimReward. rewardRatePerSecond used to compute runway (emits TreasuryLow if < 30 days).
    function sendToStaking(uint256 amount, uint256 rewardRatePerSecond) external {
        if (msg.sender != stakingContract) revert OnlyStaking();
        if (stakingContract == address(0)) revert StakingNotSet();
        if (amount == 0) return;
        rewardToken.safeTransfer(stakingContract, amount);
        emit SentToStaking(stakingContract, amount);
        uint256 balance = rewardToken.balanceOf(address(this));
        if (minBalanceForAlert > 0 && balance < minBalanceForAlert) {
            emit TreasuryLow(balance);
        }
        if (rewardRatePerSecond > 0) {
            uint256 runwayDays = balance / (rewardRatePerSecond * SECONDS_PER_DAY);
            if (runwayDays < MIN_RUNWAY_DAYS_FOR_ALERT) {
                emit TreasuryLow(balance);
            }
        }
    }

    function balanceOf() external view returns (uint256) {
        return rewardToken.balanceOf(address(this));
    }

    /// @notice Available rewards (balanceOf alias for frontend).
    function availableRewards() external view returns (uint256) {
        return rewardToken.balanceOf(address(this));
    }

    /// @notice Runway in days for the given reward rate (per second). If rate is 0, returns type(uint256).max.
    function rewardRunwayDays(uint256 rewardRatePerSecond) external view returns (uint256) {
        if (rewardRatePerSecond == 0) return type(uint256).max;
        uint256 balance = rewardToken.balanceOf(address(this));
        return balance / (rewardRatePerSecond * SECONDS_PER_DAY);
    }

    function withdrawUnused(uint256 amount, address to) external onlyRole(ADMIN_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        rewardToken.safeTransfer(to, amount);
        emit UnusedWithdrawn(to, amount);
    }
}

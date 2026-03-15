// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRewardsTreasury {
    function sendToStaking(uint256 amount, uint256 rewardRatePerSecond) external;
    function balanceOf() external view returns (uint256);
    function availableRewards() external view returns (uint256);
    function rewardRunwayDays(uint256 rewardRatePerSecond) external view returns (uint256);
}

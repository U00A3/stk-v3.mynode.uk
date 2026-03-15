// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IValidatorRegistry} from "./IValidatorRegistry.sol";
import {IRewardsTreasury} from "./IRewardsTreasury.sol";

/**
 * @title Staking
 * @notice Main staking contract: validator registration, delegations, rewards (APR 7% target / 12% max), commission, stake saturation.
 */
contract Staking is ReentrancyGuard, Pausable, AccessControl {
    using SafeERC20 for IERC20;

    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant MIN_APR_BPS = 300;     // 3%
    uint256 public constant MAX_APR_BPS = 1200;    // 12%
    uint256 public constant MAX_COMMISSION_BPS = 2000; // 20%
    uint256 public constant WITHDRAW_DELAY = 1 days;
    uint256 public constant COMMISSION_CHANGE_DELAY = 7 days;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;
    IValidatorRegistry public immutable validatorRegistry;
    IRewardsTreasury public rewardsTreasury;

    uint256 public minSelfStake;
    /// @dev Saturation: maxValidatorStake = totalStaked * saturationBps / 10000 (dynamic).
    uint256 public saturationBps;
    /// @dev APR in basis points (e.g. 700 = 7%). Admin sets in [MIN_APR_BPS, MAX_APR_BPS].
    uint256 public aprBps = 700;
    /// @dev Max number of delegators per validator (gas / DoS).
    uint256 public maxDelegators = 1000;
    mapping(uint256 => uint256) public delegatorCount;
    mapping(uint256 => uint16) public pendingCommissionBps;
    mapping(uint256 => uint256) public commissionChangeUnlockAt;

    struct Validator {
        address operator;
        uint16 commissionBps;
        uint256 selfStake;
        uint256 totalStake;
        bool active;
    }

    struct Delegation {
        uint256 amount;
        uint256 rewardDebt;
    }

    struct ValidatorMeta {
        string name;
        string website;
        string twitter;
        string github;
        string email;
        string chat;
        string description;
        string avatarUrl;
    }

    uint256 public nextValidatorId;
    mapping(uint256 => Validator) public validators;
    mapping(address => uint256) public operatorToValidatorId;

    mapping(uint256 => ValidatorMeta) internal _validatorMeta;

    /// @dev delegations[delegator][validatorId]
    mapping(address => mapping(uint256 => Delegation)) public delegations;

    /// @dev Pending unstake: amount and unlock time
    mapping(address => mapping(uint256 => uint256)) public pendingUnstakeAmount;
    mapping(address => mapping(uint256 => uint256)) public pendingUnstakeUnlockAt;

    uint256 public totalStaked;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public rewardRate;

    event ValidatorRegistered(uint256 indexed validatorId, address operator, uint16 commissionBps, uint256 selfStake);
    event Staked(address indexed delegator, uint256 indexed validatorId, uint256 amount);
    event Redelegated(address indexed delegator, uint256 fromValidatorId, uint256 toValidatorId, uint256 amount);
    event Unstaked(address indexed delegator, uint256 indexed validatorId, uint256 amount, uint256 unlockAt);
    event Withdrawn(address indexed delegator, uint256 indexed validatorId, uint256 amount);
    event RewardClaimed(address indexed delegator, uint256 indexed validatorId, uint256 delegatorReward, uint256 commission);
    event RewardsTreasurySet(address indexed treasury);
    event SaturationBpsSet(uint256 saturationBps);
    event MinSelfStakeSet(uint256 minSelfStake);
    event APRSet(uint256 aprBps);
    event MaxDelegatorsSet(uint256 maxDelegators);
    event CommissionChangeRequested(uint256 indexed validatorId, uint16 newCommissionBps, uint256 unlockAt);
    event CommissionChangeApplied(uint256 indexed validatorId, uint16 newCommissionBps);
    event EmergencyWithdrawn(address indexed delegator, uint256 indexed validatorId, uint256 amount);
    event ValidatorMetaUpdated(uint256 indexed validatorId);
    event ValidatorDeactivated(uint256 indexed validatorId, address indexed operator);

    error NotValidator();
    error ValidatorAlreadyRegistered();
    error ValidatorNotActive();
    error CommissionTooHigh();
    error SelfStakeTooLow();
    error InvalidAmount();
    error InsufficientDelegation();
    error SaturationExceeded();
    error WithdrawNotUnlocked();
    error NoPendingWithdraw();
    error ZeroAddress();
    error SameValidator();
    error CommissionChangeNotReady();
    error MaxDelegatorsReached();
    error NotValidatorOperator();

    constructor(
        address _stakingToken,
        address _rewardToken,
        address _validatorRegistry,
        address admin
    ) {
        if (_stakingToken == address(0) || _rewardToken == address(0) || _validatorRegistry == address(0) || admin == address(0)) revert ZeroAddress();
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        validatorRegistry = IValidatorRegistry(_validatorRegistry);
        lastUpdateTime = block.timestamp;
        minSelfStake = 50_000 * 1e18;
        saturationBps = 500; // 5%
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    function setRewardsTreasury(address _treasury) external onlyRole(ADMIN_ROLE) {
        rewardsTreasury = IRewardsTreasury(_treasury);
        emit RewardsTreasurySet(_treasury);
    }

    function setSaturationBps(uint256 _saturationBps) external onlyRole(ADMIN_ROLE) {
        require(_saturationBps <= 10000, "max 100%");
        saturationBps = _saturationBps;
        emit SaturationBpsSet(_saturationBps);
    }

    function setMinSelfStake(uint256 _minSelfStake) external onlyRole(ADMIN_ROLE) {
        minSelfStake = _minSelfStake;
        emit MinSelfStakeSet(_minSelfStake);
    }

    function setAPR(uint256 _aprBps) external onlyRole(ADMIN_ROLE) {
        require(_aprBps >= MIN_APR_BPS && _aprBps <= MAX_APR_BPS, "APR out of range");
        aprBps = _aprBps;
        emit APRSet(_aprBps);
    }

    function setMaxDelegators(uint256 _maxDelegators) external onlyRole(ADMIN_ROLE) {
        maxDelegators = _maxDelegators;
        emit MaxDelegatorsSet(_maxDelegators);
    }

    function requestCommissionChange(uint256 validatorId, uint16 newCommissionBps) external {
        Validator storage v = validators[validatorId];
        if (v.operator != msg.sender) revert NotValidatorOperator();
        if (newCommissionBps > MAX_COMMISSION_BPS) revert CommissionTooHigh();
        uint256 unlockAt = block.timestamp + COMMISSION_CHANGE_DELAY;
        pendingCommissionBps[validatorId] = newCommissionBps;
        commissionChangeUnlockAt[validatorId] = unlockAt;
        emit CommissionChangeRequested(validatorId, newCommissionBps, unlockAt);
    }

    function applyCommissionChange(uint256 validatorId) external {
        Validator storage v = validators[validatorId];
        if (v.operator != msg.sender) revert NotValidatorOperator();
        if (block.timestamp < commissionChangeUnlockAt[validatorId]) revert CommissionChangeNotReady();
        uint16 newBps = pendingCommissionBps[validatorId];
        pendingCommissionBps[validatorId] = 0;
        commissionChangeUnlockAt[validatorId] = 0;
        v.commissionBps = newBps;
        emit CommissionChangeApplied(validatorId, newBps);
    }

    /// @dev Saturation cap applies only to delegations (totalStake - selfStake). Self-stake is excluded from the limit.
    function getSaturationCap() public view returns (uint256) {
        if (totalStaked == 0) return type(uint256).max;
        return (totalStaked * saturationBps) / 10_000;
    }

    function _checkSaturation(uint256 validatorId, uint256 additionalAmount) internal view returns (bool) {
        Validator storage v = validators[validatorId];
        uint256 newTotal = totalStaked + additionalAmount;
        uint256 cap = (newTotal * saturationBps) / 10_000;
        uint256 delegationsOnly = v.totalStake - v.selfStake + additionalAmount;
        return delegationsOnly <= cap;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        uint256 elapsed = block.timestamp - lastUpdateTime;
        return rewardPerTokenStored + (elapsed * rewardRate * 1e18) / totalStaked;
    }

    function _syncRewardRate() internal {
        if (address(rewardsTreasury) == address(0)) return;
        uint256 balance = rewardsTreasury.balanceOf();
        if (totalStaked == 0) {
            rewardRate = 0;
            return;
        }
        uint256 targetRate = (totalStaked * aprBps) / 10_000 / SECONDS_PER_YEAR;
        uint256 maxRate = (totalStaked * MAX_APR_BPS) / 10_000 / SECONDS_PER_YEAR;
        uint256 affordableRate = balance / SECONDS_PER_YEAR;
        uint256 newRate = targetRate;
        if (newRate > maxRate) newRate = maxRate;
        if (newRate > affordableRate) newRate = affordableRate;
        rewardRate = newRate;
    }

    modifier updateGlobalReward() {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = block.timestamp;
        _syncRewardRate();
        _;
    }

    function registerValidator(uint16 commissionBps, uint256 selfStakeAmount) external nonReentrant whenNotPaused updateGlobalReward {
        if (!validatorRegistry.isValidator(msg.sender)) revert NotValidator();
        if (operatorToValidatorId[msg.sender] != 0) revert ValidatorAlreadyRegistered();
        if (commissionBps > MAX_COMMISSION_BPS) revert CommissionTooHigh();
        if (selfStakeAmount < minSelfStake) revert SelfStakeTooLow();

        uint256 id = ++nextValidatorId;
        validators[id] = Validator({
            operator: msg.sender,
            commissionBps: commissionBps,
            selfStake: selfStakeAmount,
            totalStake: selfStakeAmount,
            active: true
        });
        operatorToValidatorId[msg.sender] = id;

        totalStaked += selfStakeAmount;
        delegations[msg.sender][id] = Delegation({amount: selfStakeAmount, rewardDebt: (selfStakeAmount * rewardPerTokenStored) / 1e18});
        delegatorCount[id] = 1;

        stakingToken.safeTransferFrom(msg.sender, address(this), selfStakeAmount);
        emit ValidatorRegistered(id, msg.sender, commissionBps, selfStakeAmount);
    }

    /// @dev Auto-claim accrued rewards for a delegator. Called before any delegation amount change.
    function _claimReward(address delegator, uint256 validatorId) internal {
        (uint256 rawReward, uint256 commission, uint256 delegatorShare) = earned(delegator, validatorId);
        if (rawReward == 0) return;

        Delegation storage d = delegations[delegator][validatorId];
        d.rewardDebt = (d.amount * rewardPerTokenStored) / 1e18;

        if (address(rewardsTreasury) == address(0)) return;
        uint256 totalNeeded = delegatorShare + commission;
        uint256 available = rewardsTreasury.balanceOf();
        if (available < totalNeeded) totalNeeded = available;
        if (totalNeeded == 0) return;

        uint256 delegatorShareActual = (totalNeeded * delegatorShare) / (delegatorShare + commission);
        uint256 commissionActual = totalNeeded - delegatorShareActual;

        rewardsTreasury.sendToStaking(totalNeeded, rewardRate);
        if (delegatorShareActual > 0) {
            rewardToken.safeTransfer(delegator, delegatorShareActual);
        }
        if (commissionActual > 0) {
            rewardToken.safeTransfer(validators[validatorId].operator, commissionActual);
        }
        emit RewardClaimed(delegator, validatorId, delegatorShareActual, commissionActual);
    }

    function stake(uint256 validatorId, uint256 amount) external nonReentrant whenNotPaused updateGlobalReward {
        Validator storage v = validators[validatorId];
        if (!v.active || !validatorRegistry.isValidator(v.operator)) revert ValidatorNotActive();
        if (amount == 0) revert InvalidAmount();
        if (!_checkSaturation(validatorId, amount)) revert SaturationExceeded();

        Delegation storage d = delegations[msg.sender][validatorId];
        if (d.amount == 0) {
            if (delegatorCount[validatorId] >= maxDelegators) revert MaxDelegatorsReached();
            delegatorCount[validatorId]++;
        } else {
            _claimReward(msg.sender, validatorId);
        }
        d.amount += amount;
        d.rewardDebt = (d.amount * rewardPerTokenStored) / 1e18;
        v.totalStake += amount;
        totalStaked += amount;

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, validatorId, amount);
    }

    function redelegate(uint256 fromValidatorId, uint256 toValidatorId, uint256 amount) external nonReentrant whenNotPaused updateGlobalReward {
        if (fromValidatorId == toValidatorId) revert SameValidator();
        Validator storage vTo = validators[toValidatorId];
        if (!vTo.active || !validatorRegistry.isValidator(vTo.operator)) revert ValidatorNotActive();
        if (amount == 0) revert InvalidAmount();

        Delegation storage dFrom = delegations[msg.sender][fromValidatorId];
        if (dFrom.amount < amount) revert InsufficientDelegation();
        if (!_checkSaturation(toValidatorId, amount)) revert SaturationExceeded();

        Validator storage vFrom = validators[fromValidatorId];
        _claimReward(msg.sender, fromValidatorId);
        dFrom.amount -= amount;
        dFrom.rewardDebt = (dFrom.amount * rewardPerTokenStored) / 1e18;
        if (dFrom.amount == 0) delegatorCount[fromValidatorId]--;
        vFrom.totalStake -= amount;

        Delegation storage dTo = delegations[msg.sender][toValidatorId];
        if (dTo.amount == 0) {
            if (delegatorCount[toValidatorId] >= maxDelegators) revert MaxDelegatorsReached();
            delegatorCount[toValidatorId]++;
        } else {
            _claimReward(msg.sender, toValidatorId);
        }
        dTo.amount += amount;
        dTo.rewardDebt = (dTo.amount * rewardPerTokenStored) / 1e18;
        vTo.totalStake += amount;

        emit Redelegated(msg.sender, fromValidatorId, toValidatorId, amount);
    }

    function unstake(uint256 validatorId, uint256 amount) external nonReentrant whenNotPaused updateGlobalReward {
        Delegation storage d = delegations[msg.sender][validatorId];
        if (d.amount < amount) revert InsufficientDelegation();
        if (amount == 0) revert InvalidAmount();

        _claimReward(msg.sender, validatorId);
        d.amount -= amount;
        d.rewardDebt = (d.amount * rewardPerTokenStored) / 1e18;
        if (d.amount == 0) delegatorCount[validatorId]--;
        validators[validatorId].totalStake -= amount;
        totalStaked -= amount;

        uint256 unlockAt = block.timestamp + WITHDRAW_DELAY;
        pendingUnstakeAmount[msg.sender][validatorId] += amount;
        if (pendingUnstakeUnlockAt[msg.sender][validatorId] < unlockAt) {
            pendingUnstakeUnlockAt[msg.sender][validatorId] = unlockAt;
        }

        emit Unstaked(msg.sender, validatorId, amount, unlockAt);
    }

    function withdraw(uint256 validatorId) external nonReentrant {
        uint256 amount = pendingUnstakeAmount[msg.sender][validatorId];
        if (amount == 0) revert NoPendingWithdraw();
        if (block.timestamp < pendingUnstakeUnlockAt[msg.sender][validatorId]) revert WithdrawNotUnlocked();

        pendingUnstakeAmount[msg.sender][validatorId] = 0;
        pendingUnstakeUnlockAt[msg.sender][validatorId] = 0;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, validatorId, amount);
    }

    /// @notice Withdraw stake without rewards and without cooldown - only when contract is paused.
    function emergencyWithdraw(uint256 validatorId) external nonReentrant whenPaused updateGlobalReward {
        Delegation storage d = delegations[msg.sender][validatorId];
        uint256 amount = d.amount;
        if (amount == 0) return;

        d.amount = 0;
        d.rewardDebt = 0;
        delegatorCount[validatorId]--;
        validators[validatorId].totalStake -= amount;
        totalStaked -= amount;

        stakingToken.safeTransfer(msg.sender, amount);
        emit EmergencyWithdrawn(msg.sender, validatorId, amount);
    }

    function earned(address delegator, uint256 validatorId) public view returns (uint256 rawReward, uint256 commission, uint256 delegatorShare) {
        Delegation storage d = delegations[delegator][validatorId];
        if (d.amount == 0) return (0, 0, 0);
        Validator storage v = validators[validatorId];
        uint256 acc = rewardPerToken();
        uint256 accumulated = (d.amount * acc) / 1e18;
        rawReward = accumulated > d.rewardDebt ? accumulated - d.rewardDebt : 0;
        commission = (rawReward * v.commissionBps) / 10_000;
        delegatorShare = rawReward - commission;
    }

    function claimReward(uint256 validatorId) external nonReentrant whenNotPaused updateGlobalReward {
        _claimReward(msg.sender, validatorId);
    }

    function setValidatorMeta(uint256 validatorId, ValidatorMeta calldata meta) external {
        if (validators[validatorId].operator != msg.sender) revert NotValidatorOperator();
        _validatorMeta[validatorId] = meta;
        emit ValidatorMetaUpdated(validatorId);
    }

    function getValidatorMeta(uint256 validatorId) external view returns (ValidatorMeta memory) {
        return _validatorMeta[validatorId];
    }

    function deactivateValidator(uint256 validatorId) external {
        Validator storage v = validators[validatorId];
        bool isAdmin = hasRole(ADMIN_ROLE, msg.sender);
        bool isOperator = v.operator == msg.sender;
        if (!isAdmin && !isOperator) revert NotValidatorOperator();

        v.active = false;
        delete _validatorMeta[validatorId];
        operatorToValidatorId[v.operator] = 0;

        emit ValidatorDeactivated(validatorId, v.operator);
    }

    function getValidator(uint256 validatorId) external view returns (Validator memory) {
        return validators[validatorId];
    }

    function getSaturationForValidator(uint256 validatorId) external view returns (uint256 delegatedStake, uint256 cap) {
        Validator storage v = validators[validatorId];
        delegatedStake = v.totalStake - v.selfStake;
        cap = getSaturationCap();
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
}

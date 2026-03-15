# Shared Node Staking  Full documentation

Table of contents:

1. [Design Report](#1-design-report)
2. [Deploy Plan](#2-deploy-plan)
3. [Security](#3-security)
4. [Architecture](#4-architecture)
5. [Reward Calculation Model](#5-reward-calculation-model)
6. [Usage](#6-usage)
7. [How-to](#7-how-to)
8. [Test Report](#8-test-report)
9. [Coverage / uncovered branches](#9-coverage--uncovered-branches)
10. [Audit Checklist Result](#10-audit-checklist-result)
11. [Self-audit (Slither + Fuzzer)](#11-self-audit-slither--fuzzer)
12. [Frontend (demo stk-v3)](#12-frontend-demo-stk-v3)

---

# 1. Design Report

## Overview

The system consists of **three contracts**: **ValidatorRegistry** (validator whitelist), **Staking** (validator registration, delegations, rewards, commission, stake saturation, metadata), **RewardsTreasury** (holds reward tokens, funded by team, sends to Staking on claim).

- **Testnet vs production:** On **testnet** you can use **ValidatorRegistryOpen**  no whitelist, any address can register **one** validator (Staking enforces the "one per address" limit). On **production** use **ValidatorRegistry** with whitelist (only admin adds addresses via `approveValidator`).

- **Target APR:** 7%, **max APR:** 12% (dynamic emission depending on TVL and treasury balance).
- **Commission:** validator sets up to 20% (MAX_COMMISSION_BPS); part of delegator reward goes to operator.
- **Stake saturation:** maxValidatorStake = totalStaked × saturationBps / 10000 (dynamic; default 5%).
- **Unstake:** 24h delay before token payout (`withdraw` after `unstake`).
- **Auto-claim:** `unstake`, additional `stake` and `redelegate` automatically pay out accrued rewards (`_claimReward`) before changing delegation amount  rewards are not lost.
- **APR:** configurable by admin (setAPR), min 3%, max 12%.
- **Commission change delay:** requestCommissionChange → 7 days → applyCommissionChange (operator only).
- **Max delegators** per validator (e.g. 1000)  gas/DoS limit.
- **Emergency withdraw:** when contract is paused  unstake without rewards, without cooldown.
- **Hard stop treasury:** claimReward pays min(calculated, treasury.balanceOf()); runway in Treasury (availableRewards, rewardRunwayDays).
- **Validator metadata:** on-chain metadata (name, website, twitter, github, telegram, discord, description, avatar)  `setValidatorMeta`.
- **Deactivate validator:** operator or admin can deactivate a validator (`deactivateValidator`).

## Design Choices

### Three contracts

- **ValidatorRegistry**  single responsibility: whitelist. Only admin (multisig) adds/removes validators. **Production:** use ValidatorRegistry; registration only for whitelisted addresses.
- **ValidatorRegistryOpen**  **testnet** variant: implementation of `IValidatorRegistry` where `isValidator(address)` always returns `true`. No whitelist; any address can register at most one validator (Staking: `operatorToValidatorId`). **Do not use in production.**
- **Staking**  all staking and reward logic; depends on registry (only `isValidator` can register) and treasury (pull rewards on claim).
- **RewardsTreasury**  holds reward token; team calls `depositRewards`; on `claimReward` Staking calls `treasury.sendToStaking(amount)` and distributes rewards (delegator + commission to operator).

### Dynamic emission (APR)

- **rewardRate** is not set manually. Derived from: (1) Target APR 7% on totalStaked, (2) Max APR 12%, (3) Runway (balance / SECONDS_PER_YEAR).
- Effective rate: `rewardRate = min(targetRate(7%), maxRate(12%), balance / SECONDS_PER_YEAR)`.
- Rate re-synced on: stake, unstake, redelegate, registerValidator, claimReward (modifier `updateGlobalReward`).

### Stake saturation

- Limit per validator: `validator.totalStake <= totalStaked * saturationBps / 10000`. Default saturationBps = 500 (5%). Checked on stake and redelegate: `_checkSaturation(validatorId, amount)`.
- Self-stake is included in validator's `totalStake`, but the limit applies only to delegations (`totalStake - selfStake <= cap`).

### Commission

- On registration validator specifies commissionBps (max 2000 = 20%). On claimReward: rawReward, commission = rawReward × commissionBps / 10000; delegator gets rawReward - commission, operator gets commission.

### Unstake and withdraw delay

- `unstake(validatorId, amount)`  automatically claims rewards (`_claimReward`), decreases delegation, sets `pendingUnstakeAmount` and `pendingUnstakeUnlockAt = block.timestamp + 24h`. `withdraw(validatorId)`  payout after 24h.

### Auto-claim (`_claimReward`)

- Internal function called automatically before changing `delegation.amount` in `unstake`, `stake` (when d.amount > 0) and `redelegate` (for both delegations: source and destination).
- Prevents loss of accrued rewards when resetting `rewardDebt`.
- Public `claimReward(validatorId)` delegates to `_claimReward`.

### Validator metadata

- Struct `ValidatorMeta { name, website, twitter, github, email, chat, description, avatarUrl }`.
- `setValidatorMeta(validatorId, meta)`  operator only.
- `getValidatorMeta(validatorId)`  public view.
- Fields `email` and `chat` used as Telegram handle and Discord handle respectively.

### Deactivate validator

- `deactivateValidator(validatorId)`  callable by operator or admin.
- Sets `active = false`, clears metadata, zeros `operatorToValidatorId`.
- Existing delegators can `unstake` or `redelegate`.
- Operator can re-register with a new ID.

### Monitoring treasury

- `availableRewards()`, `rewardRunwayDays(rewardRatePerSecond)`. Treasury emits `TreasuryLow` when balance < minBalanceForAlert or runway < 30 days (on `sendToStaking`).

## Constants (Staking)

| Constant             | Value    | Meaning                          |
|----------------------|----------|-----------------------------------|
| SECONDS_PER_YEAR     | 365 days | APR i runway                     |
| MIN_APR_BPS          | 300      | 3% min APR (setAPR)              |
| MAX_APR_BPS          | 1200     | 12% max APR                      |
| MAX_COMMISSION_BPS   | 2000     | 20% max commission validatora    |
| WITHDRAW_DELAY       | 1 days   | 24h delay między unstake a withdraw |
| COMMISSION_CHANGE_DELAY | 7 days | Commission change delay         |
| aprBps (config)      | 700 default | Admin: setAPR(300–1200)       |
| maxDelegators        | 1000 default | Admin: setMaxDelegators      |

## Deployment

**Production (with whitelist):** Order ValidatorRegistry → Staking → RewardsTreasury. Script `Deploy.s.sol`. After deploy: `staking.setRewardsTreasury(treasury)`, `treasury.setStakingContract(staking)`. Admin calls `registry.approveValidator(addr)`; validator `registerValidator(commissionBps, selfStake)`; team `treasury.depositRewards(amount)`.

**Testnet (no whitelist):** Script `DeployTestnetOpen.s.sol`  deploys **ValidatorRegistryOpen** + **Staking**, connects to existing Treasury. Env: `DEPLOYER_PRIVATE_KEY`, `STAKING_TOKEN`, `REWARD_TOKEN`, `REWARDS_TREASURY`. Any address can register one validator. After first registration: `staking.claimReward(1)` (sync `rewardRate`).

## Summary

| Aspect           | Implementation                                                                 |
|------------------|-------------------------------------------------------------------------------|
| Architecture     | 3 contracts: ValidatorRegistry → Staking → RewardsTreasury                    |
| Whitelist        | Production: approved only (ValidatorRegistry). Testnet: ValidatorRegistryOpen  anyone can register one validator. |
| Emission         | Dynamic (target 7% APR, max 12% APR, runway cap from treasury)                 |
| Commission       | Up to 20% of rewards to validator operator                                   |
| Saturation       | maxValidatorStake = totalStaked × saturationBps (dynamic)                    |
| Unstake          | 24h delay before withdraw; auto-claim rewards                                |
| Auto-claim       | _claimReward() in unstake, stake, redelegate  rewards are not lost          |
| Commission change | request → 7 d → apply (operator only)                                        |
| Metadata         | On-chain ValidatorMeta (name, website, social, description, avatar)           |
| Deactivate       | Operator or admin deactivates validator; delegators can unstake/redelegate  |
| Emergency withdraw | whenPaused: unstake without rewards, without cooldown                       |
| Treasury         | availableRewards, rewardRunwayDays; claim cap = min(calc, balance); TreasuryLow |

---

# 2. Deploy Plan

System of three contracts: ValidatorRegistry, Staking, RewardsTreasury. Target APR 7%, max 12%, commission up to 20%, stake saturation (e.g. 5%), 24h withdraw delay.

## 1. Parameters

| Parameter         | Value   |
|--------------------|--------|
| Target APR         | **7%** |
| Max APR            | **12%** |
| Max commission     | **20%** (2000 bps) |
| Saturation (default) | **5%** |
| Withdraw delay     | **24h** after unstake |
| Min self-stake     | Configurable (default 50_000 × 1e18) |

Funding: team calls `treasury.depositRewards(amount)`.

## 2. Deploy requirements

Constructor ValidatorRegistry: `(admin)`. Constructor Staking: `(stakingToken, rewardToken, validatorRegistry, admin)`. Constructor RewardsTreasury: `(rewardToken, admin)`. After deploy: `staking.setRewardsTreasury(address(treasury))`, `treasury.setStakingContract(address(staking))`, grant ADMIN_ROLE. Tokens must not be fee-on-transfer.

## 3. Deploy steps

1. Deploy ValidatorRegistry(admin).
2. Deploy Staking(stakingToken, rewardToken, address(registry), admin).
3. Deploy RewardsTreasury(rewardToken, admin).
4.–6. grantRole ADMIN_ROLE.
7. Wiring: setRewardsTreasury, setStakingContract.
8. Whitelist: approveValidator.
9. Funding: depositRewards.
10. Optional: setMinBalanceForAlert(amountFor30Days).

Script `Deploy.s.sol` performs steps 1–7.

### 3b. Testnet deploy (no whitelist, ValidatorRegistryOpen)

For testnet: `DeployTestnetOpen.s.sol` deploys ValidatorRegistryOpen + Staking and connects to **existing** Treasury. No whitelist  any address can register one validator. Env: `DEPLOYER_PRIVATE_KEY`, `STAKING_TOKEN`, `REWARD_TOKEN`, `REWARDS_TREASURY`. After deploy: update frontend (NEXT_PUBLIC_STAKING_ADDRESS, NEXT_PUBLIC_VALIDATOR_REGISTRY). After first validator registration call `staking.claimReward(1)` (sync rewardRate).

```bash
source .env
forge script script/DeployTestnetOpen.s.sol:DeployTestnetOpen --rpc-url "$RPC_URL" --broadcast --legacy
```
(The `--legacy` option is sometimes required on some networks.)

## 4. Env variables (Deploy.s.sol)

| Variable             | Description |
|----------------------|-------------|
| DEPLOYER_PRIVATE_KEY | Deployer key |
| STAKING_TOKEN        | Staking token address |
| REWARD_TOKEN         | (optional) reward token address |
| RPC_URL              | Network RPC (e.g. from .env) |

```bash
source .env
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast
```

## 5. Monitoring

Staking: `totalStaked()`, `rewardRate()`, `getSaturationCap()`, `getSaturationForValidator(id)`, `earned(delegator, validatorId)`. RewardsTreasury: `balanceOf()`, event `TreasuryLow(balance)`. Off-chain: runway ≈ `treasury.balanceOf() / staking.rewardRate()`; refill przed wyczerpaniem.

---

# 3. Security

**Disclaimer:** This contract set **has not been audited**. It is intended as a reference implementation. Use at your own risk.

## Assumptions

- **Validator does not participate in network consensus.** No slashing, no downtime penalties.
- **Staking and reward tokens must not be fee-on-transfer.**
- `stakingToken` and `rewardToken` are standard ERC20 (no callbacks that change balance).
- **ValidatorRegistry:** only ADMIN adds/removes validators.
- **RewardsTreasury:** rewards deposited by admin; Staking does not promise more than treasury balance and 12% APR limit allow.
- Roles granted only to trusted addresses.

## Risks and mitigations

| Risk   | Mitigation |
|--------|-----------|
| Reentrancy | ReentrancyGuard (OZ), CEI, SafeERC20 |
| Emergency halt | Pausable; ADMIN_ROLE only |
| Unauthorized parameter changes | AccessControl (ADMIN_ROLE) |
| Wrong accounting on rate sync | updateGlobalReward before changing totalStaked |
| APR exceedance | MAX_APR_BPS (12%) and runway cap the rate |
| Overflow | Solidity 0.8+ |
| Validator concentration | Stake saturation (saturationBps % totalStaked) |
| Whitelist bypass | Only validatorRegistry.isValidator() can registerValidator |
| Treasury | sendToStaking only from stakingContract |
| Reward loss on unstake/stake/redelegate | Auto-claim: _claimReward() before changing delegation |

## Threat model (summary)

- **External attacker:** no ADMIN_ROLE; cannot change parameters or withdraw from treasury outside the claim path.
- **Malicious token:** fee-on-transfer or balance-changing callbacks break accounting  excluded in docs.
- **Low TVL / low treasury balance:** dynamic emission caps rate (12% + runway).

## Limitations

- No formal security audit.
- Reference/educational template, not production-ready.
- Treasury must be funded; monitor balance and TreasuryLow.
- Withdraw delay 24h.
- Auto-claim: unstake, additional stake and redelegate automatically pay out accrued rewards  prevents reward loss when changing delegation amount.

## Audit

Structure prepared for review: OZ, clear reward and saturation logic. This does not replace an independent audit before production.

---

# 4. Architecture

## Flow between contracts

```
Team (admin)
    │ approveValidator / removeValidator
    ▼
ValidatorRegistry (whitelist)
    │ isValidator(operator)
    ▼
Staking  ◄───────────────────────────────  RewardsTreasury
    │ registerValidator, stake,              │ depositRewards (team)
    │ redelegate, unstake, withdraw,        │ sendToStaking(amount) ← called by Staking on claimReward
    │ claimReward, deactivateValidator       │ TreasuryLow when balance < minBalanceForAlert
```

- **Validator:** must be on whitelist (ValidatorRegistry), then calls `Staking.registerValidator(commissionBps, selfStake)`.
- **Delegator:** `stake(validatorId, amount)`, `redelegate`, `unstake`, `withdraw` (after 24h), `claimReward`.
- **Rewards:** Staking computes rate from RewardsTreasury balance and totalStaked (target 7%, max 12%); on claimReward calls `treasury.sendToStaking(amount)` and distributes (delegator + commission to operator).
- **Auto-claim:** `unstake`, additional `stake` and `redelegate` automatically pay out accrued rewards (`_claimReward`) before modifying delegation  user does not lose rewards.

## Model nagród (Staking)

- **Globalny accumulator:** `rewardPerTokenStored`, `lastUpdateTime`, `rewardRate`; `totalStaked` = suma wszystkich delegacji (w tym self-stake validatorów).
- **rewardPerToken():**  
  `rewardPerTokenStored + (block.timestamp - lastUpdateTime) * rewardRate * 1e18 / totalStaked`
- **Per delegacja:** `Delegation { amount, rewardDebt }`. Naliczone, niewypłacone:  
  `accumulated = amount * rewardPerToken() / 1e18`  
  `rawReward = accumulated > rewardDebt ? accumulated - rewardDebt : 0`  
  `commission = rawReward * validator.commissionBps / 10000`  
  delegator dostaje `rawReward - commission`, operator `commission`.
- **Auto-claim on stake change:** `_claimReward()` called internally by `unstake`, `stake` (when d.amount > 0) and `redelegate`  pays out accrued rewards before changing `amount` and `rewardDebt`, preventing reward loss.
- **Synchronizacja:** modifier `updateGlobalReward` przed każdą operacją zmieniającą stawki lub totalStaked.

## Stake saturation

- **Cap per validator:** `delegatedStake = validator.totalStake - validator.selfStake <= totalStaked * saturationBps / 10000`.
- Przy **stake** i **redelegate** wywoływane jest `_checkSaturation(validatorId, amount)`.
- View: `getSaturationCap()`, `getSaturationForValidator(validatorId)`.

## Storage (summary)

**ValidatorRegistry:**  
`validators[address] -> { approved }`; AccessControl (ADMIN_ROLE).

**Staking:**  
- Immutable: stakingToken, rewardToken, validatorRegistry.  
- Config: rewardsTreasury, minSelfStake, saturationBps, aprBps, maxDelegators.
- Validators: nextValidatorId, validators[id], operatorToValidatorId[operator], _validatorMeta[id].
- Delegations: delegations[delegator][validatorId] = { amount, rewardDebt }.
- Pending unstake: pendingUnstakeAmount[user][validatorId], pendingUnstakeUnlockAt[user][validatorId].
- Commission change: pendingCommissionBps[validatorId], commissionChangeUnlockAt[validatorId].
- Rewards: totalStaked, lastUpdateTime, rewardPerTokenStored, rewardRate.
- delegatorCount[validatorId].

**RewardsTreasury:**  
- rewardToken (immutable), stakingContract, minBalanceForAlert; AccessControl (ADMIN_ROLE).

## Kluczowe wzorce

- **CEI:** najpierw aktualizacja stanu, potem transfery (SafeERC20).
- **updateGlobalReward:** punkt synchronizacji przed operacjami zmieniającymi stawki / staki.
- **Treasury:** `setStakingContract`  only that address can call `sendToStaking`.
- **Auto-claim:** `_claimReward()`  internal function ensuring reward payout before changing delegation.

## Reward flow

```
stake / unstake / redelegate / registerValidator / claimReward
    ↓
updateGlobalReward (modifier)
    ↓
rewardPerTokenStored = rewardPerToken(); lastUpdateTime = now; _syncRewardRate()
    ↓
rewardRate = min(targetRate, maxRate, treasuryRate)
    ↓
_claimReward() [auto w unstake/stake/redelegate] → earned() → sendToStaking → transfer
```

## Tokenomics (summary)

| Parameter  | Value |
|------------|--------|
| APR target | 7% (configurable 3–12%) |
| APR max    | 12% |
| Treasury   | Funded by team (depositRewards) |
| Emission   | Continuous (per second), no epochs |
| Runway     | treasuryBalance / rewardRate |

## removeValidator  behaviour

When admin calls `registry.removeValidator(operator)`: operator is removed from whitelist. In Staking on `stake` and `redelegate` `validatorRegistry.isValidator()` is checked  removed validator does not accept new stakes or redelegations (revert `ValidatorNotActive`). Existing delegators can `unstake` or `redelegate`.

## deactivateValidator  behaviour

`deactivateValidator(validatorId)`  operator or admin. Sets `active = false`, clears metadata, zeros `operatorToValidatorId`. Delegators can `unstake` or `redelegate`. Operator can re-register with a new ID.

---

# 5. Reward Calculation Model

Model: **ciągłe naliczanie per sekunda**, stały APR z treasury, bez epok. Wzorzec zbliżony do **MasterChef (Uniswap/Sushi)**.

## Why per second

| Method        | Problem                |
|---------------|------------------------|
| per block     | Block time variable     |
| every N blocks| Still network-dependent|
| **per second**| Stable APR             |

## Reward formula

`reward = stake × APR × (time / SECONDS_PER_YEAR)`. `SECONDS_PER_YEAR = 31536000`.

Pełna formuła:
- `targetRate = totalStaked × aprBps / 10_000 / SECONDS_PER_YEAR`
- `maxRate = totalStaked × MAX_APR_BPS / 10_000 / SECONDS_PER_YEAR`
- `treasuryRate = treasuryBalance / SECONDS_PER_YEAR`
- `rewardRate = min(targetRate, maxRate, treasuryRate)`

Frequency: rewardRate recomputed on every action (modifier `updateGlobalReward`). `depositRewards` does not call Staking  new balance visible on next action.

## Global variables (Staking)

| Variable              | Meaning |
|-----------------------|---------|
| lastUpdateTime        | Last reward state update time |
| rewardPerTokenStored  | Cumulative "reward per 1 token" (1e18)  accRewardPerToken |
| rewardRate            | Reward per second for the whole pool (wei) |
| totalStaked           | Sum of all stakes |
| aprBps                | APR in bps (admin: setAPR, min 3%, max 12%) |

## Update (updateGlobalReward)

`timeDelta = now - lastUpdateTime`; `newRewards = rewardRate × timeDelta`; `rewardPerTokenStored += newRewards × 1e18 / totalStaked`; `lastUpdateTime = now`; `_syncRewardRate()`.

## Per delegator: stake, rewardDebt

`accumulated = amount × rewardPerToken() / 1e18`  
`rawReward = accumulated > rewardDebt ? accumulated - rewardDebt : 0`

On claim: `rewardDebt = amount × rewardPerTokenStored / 1e18`. Payout: `min(calculated, treasury.balanceOf())`  hard stop (proportional split delegator/validator).

**Auto-claim:** Before `unstake`, `stake` (additional) and `redelegate`, `_claimReward()` is called automatically  accrued rewards are paid out before `amount` and `rewardDebt` are updated.

## Validator commission

`rawReward = accumulated - rewardDebt`; `commission = rawReward × commissionBps / 10_000`; `delegatorShare = rawReward - commission`; `validatorShare = commission`. Commission change: `requestCommissionChange → 7 days → applyCommissionChange` (operator only).

## Variable summary for developers

| Name in document     | In contract             |
|----------------------|-------------------------|
| rewardPerSecond      | rewardRate              |
| accRewardPerToken    | rewardPerTokenStored    |
| rewardDebt           | Delegation.rewardDebt   |
| APR                  | aprBps (setAPR 300–1200 bps) |

---

# 6. Usage

## Extending the template

1. Additional roles (e.g. REWARD_MANAGER_ROLE) with onlyRole(ROLE).
2. Commission change delay  implemented.
3. Redelegation cooldown  optional.
4. Other tokens  constructors accept ERC20; no fee-on-transfer.
5. Validator metadata  extensible.

## Pre-mainnet checklist

- [ ] Security audit or review.
- [ ] Local and fork tests.
- [ ] Parameters: minSelfStake, saturationBps, treasury.minBalanceForAlert.
- [ ] After deploy: approve validators, depositRewards, setMinBalanceForAlert.
- [ ] ADMIN_ROLE to multisig.
- [ ] Source verification (forge verify-contract).
- [ ] Document addresses.

## Generating API documentation

```bash
forge doc
```

---

# 7. How-to

## Overview

ValidatorRegistry  whitelist. Staking  registration, stake/redelegate/unstake/withdraw, claim (delegator + commission), metadata, deactivate. RewardsTreasury  depositRewards, sendToStaking on claim. Parameters: APR (min 3%, max 12%), commission 20%, saturation (dynamic), 24h withdraw delay, commission change delay 7 d, maxDelegators, emergencyWithdraw whenPaused.

## Validator operations

Approval: admin `approveValidator(validatorAddress)`. Registration: `approve stakingToken`, `registerValidator(commissionBps, selfStakeAmount)`; `commissionBps ≤ 2000`, `selfStakeAmount ≥ minSelfStake`. Commission change: `requestCommissionChange(validatorId, newCommissionBps)`, after 7 d `applyCommissionChange(validatorId)`. Metadata: `setValidatorMeta(validatorId, meta)`  sets name, website, twitter, github, telegram (email field), discord (chat field), description, avatarUrl. Deactivation: `deactivateValidator(validatorId)`  operator or admin. Panel: `getValidator`, `getValidatorMeta`, `delegatorCount`, `earned`, `getSaturationForValidator`, `rewardRate`, `aprBps`.

## Delegator operations

Stake: `approve`, `stake(validatorId, amount)`; validator active, saturation. Redelegate: `redelegate(fromValidatorId, toValidatorId, amount)`. Unstake and withdraw: `unstake(validatorId, amount)` (auto-claim rewards), after 24h `withdraw(validatorId)`. Emergency withdraw (when paused): `emergencyWithdraw(validatorId)`  no rewards, no cooldown. Claim: `claimReward(validatorId)`; `earned(delegator, validatorId)`  view. Payout cap: `min(calculated, treasury.balanceOf())`.

**Auto-claim:** `unstake`, additional `stake` and `redelegate` automatically pay out accrued rewards. No need to call `claimReward` before these operations.

## What admin does

ValidatorRegistry: `approveValidator`, `removeValidator`. Staking: `setRewardsTreasury`, `setSaturationBps`, `setMinSelfStake`, `setAPR`, `setMaxDelegators`, `deactivateValidator`, `pause`, `unpause`. RewardsTreasury: `depositRewards`, `setStakingContract`, `setMinBalanceForAlert`, `availableRewards`, `rewardRunwayDays`, `withdrawUnused`.

## Deploy and configuration

Deploy: `Deploy.s.sol` (Registry → Staking → Treasury, wiring, grant role). Env: `DEPLOYER_PRIVATE_KEY`, `STAKING_TOKEN`, `REWARD_TOKEN`, `RPC_URL`. After deploy: `setRewardsTreasury`, `setStakingContract`, `approveValidator`, `depositRewards`, `setMinBalanceForAlert`.

## Cheatsheet

| Action | Who | Call |
|--------|-----|------|
| Approve validator | Admin | `registry.approveValidator(addr)` |
| Register | Validator | `staking.registerValidator(commissionBps, selfStake)` |
| Metadata | Validator | `staking.setValidatorMeta(validatorId, meta)` |
| Deactivate | Validator/Admin | `staking.deactivateValidator(validatorId)` |
| Stake | Delegator | `staking.stake(validatorId, amount)`  auto-claim |
| Redelegate | Delegator | `staking.redelegate(fromId, toId, amount)`  auto-claim |
| Unstake | Delegator | `staking.unstake(validatorId, amount)`  auto-claim |
| Withdraw | Delegator | `staking.withdraw(validatorId)` (after 24h) |
| Claim rewards | Delegator | `staking.claimReward(validatorId)` |
| Fund treasury | Admin | `treasury.depositRewards(amount)` |
| Parameters | Admin | `setSaturationBps`, `setMinSelfStake`, `setAPR`, `setMaxDelegators` |
| Commission change | Validator | `requestCommissionChange(id, bps)`, after 7 d `applyCommissionChange(id)` |
| Emergency withdraw | Delegator | `emergencyWithdraw(validatorId)` (when paused) |

---

# 8. Test Report

## Running

```bash
cd new-shared-node-staking
forge test -vv
```

## Results (last run)

34 tests, 0 failed.

### Unit tests

- `test_RegisterValidatorAndStake`  registration and stake
- `test_OnlyWhitelistedCanRegister`  whitelist only
- `test_SaturationBlocksExcessStake`  blocking when saturation exceeded
- `test_SaturationExcludesSelfStake`  self-stake excluded from saturation limit
- `test_UnstakeAndWithdrawAfterDelay`  unstake + withdraw after 24h
- `test_Redelegate`  redelegation
- `test_MinSelfStakeEnforced`  min self-stake enforced
- `test_Invariant_totalStakedEqualsSumOfValidatorStakes`  sum invariant
- `test_SetAPR`  APR change
- `test_CommissionChangeDelay`  commission change delay
- `test_MaxDelegatorsReached`  delegator limit
- `test_EmergencyWithdraw`  emergency withdraw
- `test_RemoveValidator_BlocksNewStakes`  block after removal from whitelist
- `test_SetValidatorMeta`  setting metadata
- `test_SetValidatorMeta_OnlyOperator`  only operator changes metadata
- `test_SetValidatorMeta_Update`  metadata update
- `test_DeactivateValidator_ByOperator`  deactivation by operator
- `test_DeactivateValidator_ByAdmin`  deactivation by admin
- `test_DeactivateValidator_Unauthorized`  unauthorized
- `test_DeactivateValidator_BlocksNewStakes`  blocks new stakes
- `test_DeactivateValidator_ExistingDelegatorsCanUnstake`  existing can unstake
- `test_DeactivateValidator_OperatorCanReRegister`  re-registration

### Reward + auto-claim tests

- `test_PartialUnstake_AutoClaimsRewards`  partial unstake pays rewards
- `test_FullUnstake_AutoClaimsRewards`  full unstake pays rewards
- `test_PartialUnstake_RemainingStakeContinuesEarning`  remaining stake keeps earning
- `test_Stake_AdditionalAutoClaimsRewards`  additional stake pays rewards
- `test_Redelegate_AutoClaimsRewardsFromSource`  redelegate auto-claim from source
- `test_ClaimReward_Explicit`  explicit claimReward
- `test_Commission_PaidToOperator`  commission paid to operator

### Fuzz tests (256 runs each)

- `testFuzz_Stake(uint256 amount)`  random stake amounts
- `testFuzz_Unstake(uint256 amount)`  random unstake amounts
- `testFuzz_Redelegate(uint256 amount)`  random redelegate amounts
- `testFuzz_SetSaturationBps(uint256 bps)`  random saturation values
- `testFuzz_RegisterValidator_selfStakeAndCommission(uint256, uint16)`  random registration params

Summary: **34 passed** (unit + invariant + fuzz + reward/auto-claim + metadata + deactivate).

---

# 9. Coverage / uncovered branches

## How to refresh

```bash
forge coverage --report lcov
```

## Covered paths

Registration (whitelist, min self-stake), saturation (blocking + self-stake exclusion), unstake+withdraw 24h, redelegate, whitelist, min self-stake, invariant totalStaked, fuzz stake/unstake/redelegate/setSaturationBps/registerValidator, setAPR, commission change delay, maxDelegators, emergencyWithdraw, claimReward (explicit + auto-claim), commission payout to operator, metadata (set/update/only operator), deactivateValidator (operator/admin/unauthorized/blocks stakes/existing can unstake/re-register).

## Uncovered branches (summary)

**RewardsTreasury:** constructor ZeroAddress, depositRewards(0), sendToStaking (OnlyStaking, StakingNotSet, amount==0, TreasuryLow), setMinBalanceForAlert, withdrawUnused. **Staking:** constructor ZeroAddress, setSaturationBps require, getSaturationCap(totalStaked==0), pause/unpause, _syncRewardRate (rate 0), część revertów. **ValidatorRegistry:** constructor ZeroAddress, approveValidator(0), removeValidator.

---

# 10. Audit Checklist Result

Checked: ValidatorRegistry, Staking, RewardsTreasury.

## Results (summary)

Access Control: approve/remove admin only; set* admin only; sendToStaking Staking only. Reentrancy: Staking nonReentrant on all paths with transfers. CEI: preserved. Overflow: Solidity 0.8. Timestamp: block.timestamp (minimal impact). Reward funding: rate from treasury.balanceOf(), runway. Division: totalStaked==0 handled. Emergency withdraw: emergencyWithdraw whenPaused (no rewards, no cooldown). SafeERC20: everywhere. Fee-on-transfer: excluded in docs. Pause: Staking whenNotPaused on registerValidator, stake, redelegate, unstake, claimReward; withdraw without whenNotPaused (intentional). Rescue: not in Staking (recommendation: add rescueToken with staking/reward lock). Gas/DoS: O(1), maxDelegators. Zero address: constructors, approveValidator(validator), withdrawUnused(to). Events: complete. Limits: saturation, MAX_COMMISSION_BPS, minSelfStake. Auto-claim: `_claimReward()` called internally in `unstake`, `stake` (d.amount > 0) and `redelegate`  rewards not lost on delegation amount change. Test coverage: unit, fuzz, invariant; claimReward tests, auto-claim on unstake/stake/redelegate, commission payout to operator, metadata, deactivateValidator.

## Summary

Compliant: access control, reentrancy, zero address, CEI, SafeERC20, fee-on-transfer in docs, pause, division by zero, reward funding, events, saturation/commission/min self-stake, auto-claim. Recommendations: rescueToken in Staking; optionally nonReentrant in Treasury; more tests (zero address, reentrancy). Top 5 risks: Reentrancy (Guard), Wrong reward math (tests + auto-claim), Admin rug (no rescue), Fee-on-transfer (excluded in docs), Zero address (checks).

---

# 11. Self-audit (Slither + Fuzzer)

## Slither  how to run

```bash
cd new-shared-node-staking
../.venv/bin/slither . --solc-remaps "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/" --filter-paths "lib/"
```

## Slither  results (summary)

divide-before-multiply (Staking.earned)  low. incorrect-equality (rawReward==0)  low. missing-zero-check (setStakingContract)  low. timestamp (unstake, withdraw, claimReward)  informational. missing-inheritance, naming-convention  informational. No critical or high/medium.

## Foundry  tests and fuzzer

```bash
forge test -vv
```

Fuzz tests: testFuzz_Stake, Unstake, Redelegate, SetSaturationBps, RegisterValidator_selfStakeAndCommission. Invariant: test_Invariant_totalStakedEqualsSumOfValidatorStakes. More runs: `forge test --fuzz-runs 1000`.

## Summary

Slither: 13 findings, all low/informational. Tests: **34/34 passed** (including fuzz, invariant, reward auto-claim, metadata, deactivate). Fuzzer: working.

---

# 12. Frontend (demo stk-v3)

The Next.js app (Wagmi, RainbowKit) serves as a demo for the contracts. Below are behaviours relevant to the current state.

## Rate limit w UI

- **Cel:** Ograniczenie spamowania transakcjami (wspólne dla wszystkich kart tej samej domeny).
- **Mechanizm:** localStorage (`stk-v3-tx-rate`), cooldown **20 s** per action.
- **Actions:** faucet, stake, approve (token), unstake, withdraw, claim, register.
- **Zachowanie:** Po wysłaniu tx przycisk danej akcji jest zablokowany na 20 s we wszystkich otwartych kartach; wyświetlane „Wait Xs”. Inne karty aktualizują stan przez zdarzenie `storage`.

## Odpytywanie RPC

- **React Query (Wagmi):** `refetchInterval: 30_000` ms, `staleTime: 20_000` ms, `refetchOnWindowFocus: false`  limits RPC query load.
- **NetworkStats (header):** chain stats (block, gas, TPS, avg block time) every **2 minutes** (CHAIN_POLL 120_000); RBNT price every 10 min.

## Whitelist w UI

- Gdy używany jest **ValidatorRegistry** (z whitelistą): przycisk „Register as Validator” jest wyłączony, gdy adres nie jest na whitelist (`isValidator(address)`); w modalu rejestracji wyświetlany jest komunikat i przyciski zablokowane.
- Przy **ValidatorRegistryOpen** (testnet) każdy adres ma `isValidator === true`, więc rejestracja jest dostępna (z zachowaniem limitu jednego validatora na adres w Staking).

## CAT (Compliant Asset Token)

- Required for: faucet, stake, validator registration (registration and stake buttons disabled without CAT).
- On-chain check: Bootstrap → `getContractAddress("permission")`, then Permission → `isAllowed(address)`.
- In header: CAT ✓ / CAT ✕ badge next to balance.

## Faucet

- Button in header; only when STK token is MockERC20 with `mint(to, amount)`.
- Limit **50K STK** per address  enforced in UI (balance compared to limit). CAT required.
- Rate limit: as above (20 s cooldown for "faucet" action).

## Cheatsheet (frontend)

| Element | Description |
|---------|-------------|
| Frontend env | NEXT_PUBLIC_CHAIN_ID, NEXT_PUBLIC_STAKING_ADDRESS, NEXT_PUBLIC_VALIDATOR_REGISTRY, NEXT_PUBLIC_STAKING_TOKEN, NEXT_PUBLIC_REWARD_TOKEN, NEXT_PUBLIC_TREASURY_ADDRESS |
| After testnet deploy | Update NEXT_PUBLIC_STAKING_ADDRESS and NEXT_PUBLIC_VALIDATOR_REGISTRY in `frontend/.env.local`, rebuild, restart service |

---

*This document is the single project documentation file. It reflects the current state of contracts, tests and frontend (stk-v3).*

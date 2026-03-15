# Shared Node Staking

[![Live Demo](https://img.shields.io/badge/Demo-Live%20Dashboard-green)](https://stk-v3.mynode.uk)
[![Network](https://img.shields.io/badge/network-Redbelly%20Testnet-FA423C)](https://redbelly.testnet.routescan.io/)
![Status](https://img.shields.io/badge/status-reference%20implementation-blue)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
![Solidity](https://img.shields.io/badge/Solidity-0.8.x-363636)


A modular, gas‑efficient reference implementation of a Shared Node Staking system for the Redbelly Network.

This project targets the **Redbelly Testnet** and is intended for experimentation, development, and educational use. It serves as a technical template for teams exploring staking architectures on Redbelly.

The repository contains:

- Smart contracts implementing a shared-node staking model
- A demo dashboard / reference frontend for interacting with the contracts
- Deployment scripts and a complete test suite

It is intended as a template for building staking systems and validator dashboards on Redbelly.

The system demonstrates how a shared-node staking model could work on Redbelly,
where multiple delegators **delegate stake** to validator nodes while maintaining
transparent on-chain reward accounting.

## Table of Contents

1. [What It Does](#what-it-does)
2. [Architecture](#architecture)
3. [How It Works](#how-it-works)
4. [Economic Design](#economic-design)
5. [Security Mechanisms](#security-mechanisms)
6. [Roles & Permissions](#roles--permissions)
7. [Deployment](#deployment)
8. [Frontend (Demo)](#frontend-demo)
9. [Testing](#testing)
10. [Known Limitations & Audit Status](#known-limitations--audit-status)
11. [Quick-Reference Cheatsheet](#quick-reference-cheatsheet)

---

## What It Does

Shared Node Staking lets token holders delegate their stake to approved validators and earn yield proportional to their share of the staked pool. Key capabilities:

- **Continuous rewards**  accrued per second, no epochs.
- **Flexible re-delegation**  move stake between validators without losing accumulated rewards.
- **Validator commission**  operators earn a configurable cut (up to 20%) of delegator rewards.
- **Stake saturation cap**  prevents any single validator from concentrating too much stake.
- **24-hour unstake delay**  discourages short-term speculation and protects network stability.
- **Emergency withdraw**  available when the contract is paused; no delay, no rewards.
- **On-chain validator metadata**  name, website, socials, description, avatar.

---

## High Level Architecture

```
User Wallet
    │
    ▼
Demo Dashboard (Next.js / Wagmi / RainbowKit)
    │
    ▼
Staking Smart Contracts
    ├ ValidatorRegistry
    ├ Staking
    └ RewardsTreasury
    │
    ▼
Redbelly Network
```

The repository therefore includes both the smart contracts and a demonstration interface showing how users, validators, and administrators interact with the system.

---

## Architecture

The system is composed of three purpose-built contracts:

```
Team (admin)
    │ approveValidator / removeValidator
    ▼
ValidatorRegistry              ← whitelist; single responsibility
    │ isValidator(operator)
    ▼
Staking                        ← all staking logic, reward accounting, saturation
    │ claimReward → sendToStaking(amount)
    ▼
RewardsTreasury                ← holds reward tokens; funded by team
```

| Contract | Responsibility |
|---|---|
| `ValidatorRegistry` | Whitelist. Admin-only approval/removal of validator addresses. |
| `ValidatorRegistryOpen` | Testnet variant `isValidator()` always returns `true`. **Do not use on mainnet.** |
| `Staking` | Core logic: registration, delegation, saturation, reward accrual, commission, metadata, deactivation. |
| `RewardsTreasury` | Stores reward tokens. Releases funds to `Staking` only when a user claims rewards. |

---

## How It Works

### Validator Lifecycle

1. Admin adds address to whitelist: `registry.approveValidator(addr)`
2. Operator registers: `staking.registerValidator(commissionBps, selfStakeAmount)`
   - Commission: up to 20% (`commissionBps ≤ 2000`)
   - Minimum self-stake enforced (configurable, default 50,000 tokens)
3. Operator optionally sets metadata: `setValidatorMeta(validatorId, meta)`
4. To change commission: `requestCommissionChange(...)` → wait 7 days → `applyCommissionChange(...)`
5. To deactivate: `deactivateValidator(validatorId)` (by operator or admin)
   - Existing delegators can still `unstake` or `redelegate`. Operator may re-register with a new ID.

### Delegator Lifecycle

1. `approve` staking token, then `stake(validatorId, amount)`
2. Rewards accrue continuously - no action required.
3. `redelegate(fromId, toId, amount)`  moves stake; auto-claims pending rewards first.
4. `unstake(validatorId, amount)`  auto-claims rewards, starts 24h cooldown.
5. After 24h: `withdraw(validatorId)`  tokens returned.
6. Or just `claimReward(validatorId)` to collect rewards without touching stake.

### Auto-Claim (no reward loss)

`_claimReward()` is called internally before any operation that modifies a delegation amount  `unstake`, additional `stake`, and `redelegate`. Accumulated rewards are always paid out before the internal accounting is updated. **Users never lose rewards** by performing staking operations without explicitly claiming first.

---

## Economic Design

### Dynamic Emission

The reward rate is not set manually. It is recalculated on every state-changing operation via the `updateGlobalReward` modifier, using three constraints:

```
targetRate    = totalStaked × aprBps / 10,000 / SECONDS_PER_YEAR   (target: 7% APR)
maxRate       = totalStaked × MAX_APR_BPS / 10,000 / SECONDS_PER_YEAR  (hard cap: 12%)
treasuryRate  = treasury.balanceOf() / SECONDS_PER_YEAR             (runway cap)

rewardRate    = min(targetRate, maxRate, treasuryRate)
```

This means:
- Rewards **cannot exceed** what is actually in the treasury.
- As TVL grows, the per-token rate adjusts to maintain the target APR.
- When the treasury is low, the rate automatically decreases  no cliff, no sudden stop.

### APR Parameters

| Parameter | Value |
|---|---|
| Target APR | 7% (admin-configurable) |
| Minimum APR | 3% |
| Maximum APR | 12% |
| APR update granularity | Per second (continuous) |

### Stake Saturation

To prevent stake concentration, each validator has a dynamic delegation cap:

```
maxDelegatedStake = totalStaked × saturationBps / 10,000
```

Default: `saturationBps = 500` (5%). The validator's own self-stake is excluded from this cap  only external delegations are limited. Checked on every `stake` and `redelegate`.

### Commission

At claim time:
```
commission     = rawReward × commissionBps / 10,000
delegatorShare = rawReward − commission
operatorShare  = commission
```

Commission change requires a 7-day timelock (`requestCommissionChange` → `applyCommissionChange`). Delegators always have advance notice before a rate change takes effect.

### Treasury Safety

- The treasury emits a `TreasuryLow` event when its balance drops below `minBalanceForAlert` or the runway falls under 30 days.
- Every `claimReward` call pays out `min(calculated, treasury.balanceOf())`  a hard stop that prevents over-withdrawal even in edge cases.
- View helpers: `availableRewards()`, `rewardRunwayDays(rewardRatePerSecond)`.

### Key Constants

| Constant | Value | Meaning |
|---|---|---|
| `SECONDS_PER_YEAR` | 31,536,000 | Used for APR and runway calculations |
| `MIN_APR_BPS` | 300 | 3% floor for `setAPR` |
| `MAX_APR_BPS` | 1200 | 12% ceiling |
| `MAX_COMMISSION_BPS` | 2000 | 20% max validator commission |
| `WITHDRAW_DELAY` | 1 day | Cooldown between `unstake` and `withdraw` |
| `COMMISSION_CHANGE_DELAY` | 7 days | Timelock on commission changes |

---

## Security Mechanisms

### Access Control (OpenZeppelin `AccessControl`)

| Action | Required Role |
|---|---|
| `approveValidator` / `removeValidator` | `ADMIN_ROLE` |
| `setAPR`, `setSaturationBps`, `setMaxDelegators`, `pause`, `unpause` | `ADMIN_ROLE` |
| `depositRewards`, `setMinBalanceForAlert`, `withdrawUnused` | `ADMIN_ROLE` |
| `sendToStaking` | Staking contract only |
| `registerValidator`, `setValidatorMeta`, `requestCommissionChange` | Validator operator |
| `deactivateValidator` | Operator or `ADMIN_ROLE` |

### Reentrancy Protection

- `ReentrancyGuard` (OpenZeppelin) applied on all external functions that perform token transfers in `Staking`.
- CEI (Checks-Effects-Interactions) pattern enforced throughout.
- `SafeERC20` used for all token operations.

### Overflow & Arithmetic

Solidity 0.8+ built-in overflow protection on all arithmetic. Division-by-zero on `totalStaked == 0` is explicitly handled.

### Pause & Emergency Withdraw

- `pause()` / `unpause()` callable only by `ADMIN_ROLE`.
- When paused: `stake`, `unstake`, `redelegate`, `claimReward`, `registerValidator` are all blocked.
- `withdraw` is intentionally **not** paused  users can always retrieve tokens after their cooldown.
- `emergencyWithdraw(validatorId)` is only available when paused: returns stake immediately, no cooldown, no rewards.

### Timestamp Usage

`block.timestamp` is used for `unstake` cooldown, `withdraw`, `claimReward`, and commission change delay. This is standard practice; the minor miner influence on timestamps is well below any relevant threshold for these operations.

### Slither Static Analysis

Slither was run on all three contracts. Results: 13 findings, **all low or informational severity**. No critical, high, or medium issues identified. Notable low-severity findings:

- `divide-before-multiply` in `Staking.earned`  low impact, documented.
- `incorrect-equality` (`rawReward == 0`)  informational.
- `missing-zero-check` in `setStakingContract`  informational.

### Open Recommendations

- Add `rescueToken` to `Staking` (with a lock on staking/reward tokens) to recover accidentally sent ERC20s.
- Optionally add `nonReentrant` to `RewardsTreasury.sendToStaking` for defense-in-depth.
- Fee-on-transfer tokens are explicitly **not supported**  documented in assumptions.

---

## Roles & Permissions

```
Admin (multisig recommended)
  ├── ValidatorRegistry: approve/remove validators
  ├── Staking: setAPR, setSaturationBps, setMinSelfStake, setMaxDelegators,
  │           setRewardsTreasury, pause/unpause, deactivateValidator
  └── RewardsTreasury: depositRewards, setStakingContract,
                       setMinBalanceForAlert, withdrawUnused

Validator Operator
  ├── Staking: registerValidator, setValidatorMeta, deactivateValidator,
  │           requestCommissionChange, applyCommissionChange
  └── (must be whitelisted by Admin first)

Delegator (any address)
  └── Staking: stake, redelegate, unstake, withdraw, claimReward,
              emergencyWithdraw (when paused)
```

---

## Deployment

### Production (with whitelist)

Deploy order: `ValidatorRegistry` → `Staking` → `RewardsTreasury`

```bash
source .env
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast
```

Post-deploy steps:
1. `staking.setRewardsTreasury(address(treasury))`
2. `treasury.setStakingContract(address(staking))`
3. Grant `ADMIN_ROLE` to multisig
4. `registry.approveValidator(validatorAddr)`
5. `treasury.depositRewards(amount)`
6. `treasury.setMinBalanceForAlert(amountFor30Days)`

### Testnet (open registration)

```bash
source .env
forge script script/DeployTestnetOpen.s.sol:DeployTestnetOpen \
  --rpc-url "$RPC_URL" --broadcast --legacy
```

Deploys `ValidatorRegistryOpen` + `Staking`, connects to an existing `RewardsTreasury`. No whitelist  any address can register one validator. After the first validator registers, call `staking.claimReward(1)` to sync `rewardRate`.

### Environment Variables

| Variable | Description |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | Deployer wallet private key |
| `STAKING_TOKEN` | Address of the token used for staking |
| `REWARD_TOKEN` | Address of the reward token |
| `REWARDS_TREASURY` | (Testnet only) Address of existing treasury |
| `RPC_URL` | Network RPC endpoint |

### Frontend Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | Target chain ID |
| `NEXT_PUBLIC_STAKING_ADDRESS` | Deployed Staking contract address |
| `NEXT_PUBLIC_VALIDATOR_REGISTRY` | Deployed registry contract address |
| `NEXT_PUBLIC_STAKING_TOKEN` | Staking token address |
| `NEXT_PUBLIC_REWARD_TOKEN` | Reward token address |
| `NEXT_PUBLIC_TREASURY_ADDRESS` | Treasury contract address |

---

## Frontend (Demo)

### Live Dashboard

https://stk-v3.mynode.uk

The `stk-v3` frontend is a Next.js application (Wagmi + RainbowKit) for interacting with the contracts.

**Rate limiting**  All transaction actions (stake, unstake, claim, register, faucet, approve, withdraw) are rate-limited to one per 20 seconds per domain, using `localStorage`. State is shared across browser tabs via the `storage` event.

**RPC polling**  React Query is configured with `refetchInterval: 30s`, `staleTime: 20s`, and `refetchOnWindowFocus: false` to minimise RPC load. Chain stats (block, gas, TPS) refresh every 2 minutes; RBNT price every 10 minutes.

**CAT (Compliant Asset Token)**  Faucet, stake, and validator registration require a valid CAT. Checked on-chain via the Permission contract. A CAT badge (✓/✕) is displayed next to the wallet balance in the header.

**Whitelist awareness**  When `ValidatorRegistry` is active, the "Register as Validator" button is disabled for non-whitelisted addresses. With `ValidatorRegistryOpen`, registration is available to all (subject to the one-validator-per-address limit in Staking).

---

## Testing

```bash
cd new-shared-node-staking
forge test -vv
```

**34 tests  0 failures.**

Test coverage includes:

- Registration, whitelist enforcement, min self-stake
- Saturation blocking, self-stake exclusion from saturation cap
- Unstake + withdraw with 24h delay
- Redelegation
- APR configuration, commission change delay
- Max delegators limit
- Emergency withdraw
- Auto-claim on `unstake`, additional `stake`, and `redelegate`
- Commission payout to operator
- Validator metadata: set, update, operator-only access
- Validator deactivation: by operator, by admin, unauthorized attempt, effects on new stakes and existing delegators, re-registration
- Invariant: `totalStaked == sum of all validator stakes`
- Fuzz tests (256 runs each): `stake`, `unstake`, `redelegate`, `setSaturationBps`, `registerValidator`

Generate API documentation:
```bash
forge doc
```

Refresh coverage report:
```bash
forge coverage --report lcov
```

---

## Known Limitations & Audit Status

> ⚠️ **This codebase has not been independently audited.** It is intended as a reference implementation. Use in production is at your own risk and should be preceded by a professional security review.

| Item | Status |
|---|---|
| Independent security audit | Not yet performed |
| Slither static analysis | Run; all findings low/informational |
| Fuzz testing | Passing (256 runs per test) |
| Invariant testing | Passing |
| `rescueToken` in Staking | Not implemented (recommended before mainnet) |
| Fee-on-transfer token support | Not supported  excluded in assumptions |

### Mainnet Checklist

- [ ] Independent security audit or peer review
- [ ] Local tests and fork tests completed
- [ ] Parameters reviewed: `minSelfStake`, `saturationBps`, `minBalanceForAlert`
- [ ] `ADMIN_ROLE` assigned to a multisig
- [ ] Source code verified (`forge verify-contract`)
- [ ] Contract addresses documented

---

## Quick-Reference Cheatsheet

| Action | Who | Call |
|---|---|---|
| Approve validator | Admin | `registry.approveValidator(addr)` |
| Register | Validator | `staking.registerValidator(commissionBps, selfStake)` |
| Set metadata | Validator | `staking.setValidatorMeta(validatorId, meta)` |
| Request commission change | Validator | `staking.requestCommissionChange(id, bps)` |
| Apply commission change (after 7d) | Validator | `staking.applyCommissionChange(id)` |
| Deactivate | Validator / Admin | `staking.deactivateValidator(id)` |
| Stake | Delegator | `staking.stake(validatorId, amount)` |
| Redelegate | Delegator | `staking.redelegate(fromId, toId, amount)` |
| Unstake | Delegator | `staking.unstake(validatorId, amount)` |
| Withdraw (after 24h) | Delegator | `staking.withdraw(validatorId)` |
| Claim rewards | Delegator | `staking.claimReward(validatorId)` |
| Emergency withdraw (paused only) | Delegator | `staking.emergencyWithdraw(validatorId)` |
| Fund treasury | Admin | `treasury.depositRewards(amount)` |
| Check runway | Anyone | `treasury.rewardRunwayDays(staking.rewardRate())` |
| Set APR | Admin | `staking.setAPR(bps)`  range 300–1200 |
| Set saturation | Admin | `staking.setSaturationBps(bps)` |

---

*For the full internal documentation including reward math, storage layout, architecture diagrams, and test report, see [ALL-IN-ONE.md](docs/ALL-IN-ONE.md).*

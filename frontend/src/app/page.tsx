"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useAccount, useReadContract } from "wagmi";
import Header from "@/components/Header";

function CalculatorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8" />
      <path d="M8 10h8" />
      <path d="M8 14h4" />
      <path d="M14 14h2" />
      <path d="M8 18h2" />
      <path d="M12 18h4" />
    </svg>
  );
}

function ValidatorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
import ValidatorCard from "@/components/ValidatorCard";
import StakeModal from "@/components/StakeModal";
import ManageModal from "@/components/ManageModal";
import RegisterValidatorModal from "@/components/RegisterValidatorModal";
import RewardCalculatorModal from "@/components/RewardCalculatorModal";
import { ADDRESSES, STAKING_ABI, VALIDATOR_REGISTRY_ABI, REWARDS_TREASURY_ABI } from "@/lib/contracts";
import { formatToken } from "@/lib/utils";
import { useCatStatus } from "@/hooks/useCatStatus";

function useValidatorIds() {
  const { data: nextId } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "nextValidatorId",
  });
  const count = nextId ? Number(nextId) : 0;
  return count > 0 ? Array.from({ length: count }, (_, i) => i + 1) : [];
}

function useUserDelegation(validatorId: number) {
  const { address } = useAccount();
  const { data: delegation } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "delegations",
    args: address ? [address, BigInt(validatorId)] : undefined,
    query: { enabled: !!address },
  });
  const { data: earned } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "earned",
    args: address ? [address, BigInt(validatorId)] : undefined,
    query: { enabled: !!address },
  });
  const amount = delegation?.[0] ?? 0n;
  const delegatorShare = earned?.[2] ?? 0n;
  const pendingUnstakeAmount = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "pendingUnstakeAmount",
    args: address ? [address, BigInt(validatorId)] : undefined,
    query: { enabled: !!address },
  }).data ?? 0n;
  const pendingUnstakeUnlockAt = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "pendingUnstakeUnlockAt",
    args: address ? [address, BigInt(validatorId)] : undefined,
    query: { enabled: !!address },
  }).data ?? 0n;
  return { amount, delegatorShare, pendingUnstakeAmount, pendingUnstakeUnlockAt };
}

function useCanRegisterValidator() {
  const { address } = useAccount();
  const registryAvailable = ADDRESSES.VALIDATOR_REGISTRY !== "0x0000000000000000000000000000000000000000";
  const stakingAvailable = ADDRESSES.STAKING !== "0x0000000000000000000000000000000000000000";
  const { data: isWhitelisted } = useReadContract({
    address: ADDRESSES.VALIDATOR_REGISTRY,
    abi: VALIDATOR_REGISTRY_ABI,
    functionName: "isValidator",
    args: address ? [address] : undefined,
    query: { enabled: !!address && registryAvailable },
  });
  const { data: existingId } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "operatorToValidatorId",
    args: address ? [address] : undefined,
    query: { enabled: !!address && stakingAvailable },
  });
  const whitelisted = isWhitelisted === true;
  const alreadyRegistered = existingId !== undefined && existingId !== 0n;
  const showButton = !alreadyRegistered;
  return { whitelisted, alreadyRegistered, showButton, myValidatorId: alreadyRegistered ? Number(existingId) : null };
}

export default function Home() {
  const { address, isConnected } = useAccount();
  const { hasCat } = useCatStatus(address);
  const validatorIds = useValidatorIds();
  const [stakeModalValidator, setStakeModalValidator] = useState<number | null>(null);
  const [manageModalValidator, setManageModalValidator] = useState<number | null>(null);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showRewardCalc, setShowRewardCalc] = useState(false);
  const { showButton, alreadyRegistered, myValidatorId, whitelisted } = useCanRegisterValidator();

  const { data: totalStaked } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "totalStaked",
  });
  const { data: aprBps } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "aprBps",
  });
  const { data: rewardRate } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "rewardRate",
  });
  const { data: treasuryBalance } = useReadContract({
    address: ADDRESSES.REWARDS_TREASURY,
    abi: REWARDS_TREASURY_ABI,
    functionName: "balanceOf",
  });
  const { data: runwayDays } = useReadContract({
    address: ADDRESSES.REWARDS_TREASURY,
    abi: REWARDS_TREASURY_ABI,
    functionName: "rewardRunwayDays",
    args: rewardRate !== undefined && rewardRate !== 0n ? [rewardRate] : undefined,
    query: { enabled: rewardRate !== undefined && rewardRate !== 0n },
  });

  return (
    <div className="relative z-10 min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 px-6 pb-16 lg:px-10 max-w-screen-2xl mx-auto w-full">
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="pt-12 pb-6"
        >
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight">
            Shared Node Staking
            <br />
            <span className="text-[var(--text-muted)]">Demo Interface</span>
          </h1>
          <p className="mt-4 text-sm text-[var(--text-secondary)] max-w-2xl leading-relaxed">
            This interface demonstrates how to interact with the Redbelly shared node staking contracts.
            Delegate tokens to validators, earn rewards (target APR 7%, max 12%), and manage your stake.
            Commission up to 20%. Unstake has a 24h delay before withdraw.
          </p>
        </motion.section>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="glass-card p-4 mb-6 border-[#1a1515]"
        >
          <div className="flex items-start gap-3">
            <span className="text-sm mt-0.5 text-[#666]">&#9888;</span>
            <div>
              <span className="text-xs font-medium text-[#888]">Warning</span>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-relaxed">
                These contracts are provided as templates and reference implementations. They have not been audited
                and should not be used in production environments without proper security review.
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mb-10"
        >
          <h2 className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)] mb-4">
            How to test
          </h2>
          <div className="flow-pipeline flow-pipeline-horizontal">
            <div className="flow-stage glass-card px-3 py-2.5 text-center">
              <span className="text-[10px] text-[var(--text-muted)]">01</span>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Connect wallet</p>
            </div>
            <div className="flow-arrow">
              <div className="arrow-line" />
              <div className="arrow-head" />
            </div>
            <div className="flow-stage glass-card px-3 py-2.5 text-center">
              <span className="text-[10px] text-[var(--text-muted)]">02</span>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Choose a validator</p>
            </div>
            <div className="flow-arrow">
              <div className="arrow-line" />
              <div className="arrow-head" />
            </div>
            <div className="flow-stage glass-card px-3 py-2.5 text-center">
              <span className="text-[10px] text-[var(--text-muted)]">03</span>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Approve tokens</p>
            </div>
            <div className="flow-arrow">
              <div className="arrow-line" />
              <div className="arrow-head" />
            </div>
            <div className="flow-stage glass-card px-3 py-2.5 text-center">
              <span className="text-[10px] text-[var(--text-muted)]">04</span>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Stake</p>
            </div>
            <div className="flow-arrow">
              <div className="arrow-line" />
              <div className="arrow-head" />
            </div>
            <div className="flow-stage glass-card px-3 py-2.5 text-center">
              <span className="text-[10px] text-[var(--text-muted)]">05</span>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Claim / Redelegate</p>
            </div>
            <div className="flow-arrow">
              <div className="arrow-line" />
              <div className="arrow-head" />
            </div>
            <div className="flow-stage glass-card px-3 py-2.5 text-center">
              <span className="text-[10px] text-[var(--text-muted)]">06</span>
              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">Withdraw</p>
            </div>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="mb-10"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
              Overview
            </h2>
            <motion.button
              type="button"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
              onClick={() => setShowRewardCalc(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-card)] transition-all"
            >
              <CalculatorIcon />
              <span className="text-[10px] uppercase tracking-widest">Reward calculator</span>
            </motion.button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total staked", value: formatToken(totalStaked ?? 0n) },
              { label: "APR (target)", value: aprBps !== undefined ? `${Number(aprBps) / 100}%` : "-" },
              { label: "Treasury balance", value: formatToken(treasuryBalance ?? 0n) },
              { label: "Runway", value: runwayDays !== undefined ? `~${runwayDays}d` : "-" },
            ].map(({ label, value }, i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.05 }}
                className="glass-card p-4"
              >
                <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  {label}
                </span>
                <p className="mono text-lg mt-1 text-[var(--text-primary)]">{value}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Validators */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-1">
            <motion.h2
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]"
            >
              Validators
            </motion.h2>
            {isConnected && showButton && (
              <motion.button
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.45 }}
                type="button"
                onClick={whitelisted && hasCat ? () => setShowRegisterModal(true) : undefined}
                disabled={!whitelisted || !hasCat}
                title={
                  !whitelisted
                    ? "Not on validator whitelist"
                    : !hasCat
                      ? "CAT verification required"
                      : undefined
                }
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all ${
                  whitelisted && hasCat
                    ? "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-card)]"
                    : "border-transparent text-[var(--text-muted)] opacity-50 cursor-not-allowed"
                }`}
              >
                <ValidatorIcon />
                <span className="text-[10px] uppercase tracking-widest">
                  {!whitelisted ? "Not on whitelist" : hasCat ? "Register as Validator" : "CAT required to register"}
                </span>
              </motion.button>
            )}
            {isConnected && alreadyRegistered && myValidatorId && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45 }}
                className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-full px-3 py-1"
              >
                Your node: Validator #{myValidatorId}
              </motion.span>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-muted)] mb-4">
            Choose a validator and stake. Manage to claim rewards, redelegate to another validator, or unstake (24h delay).
          </p>

          {validatorIds.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="glass-card p-8 text-center text-[var(--text-muted)] text-sm"
            >
              No validators registered yet. Deploy contracts and approve validators first.
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {validatorIds.map((id, i) => (
                <ValidatorCardWithUserData
                  key={id}
                  validatorId={id}
                  index={i}
                  onStake={() => setStakeModalValidator(id)}
                  onManage={() => setManageModalValidator(id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Template features */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="border-t border-[var(--border-subtle)] pt-8 mb-10"
        >
          <h2 className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)] mb-4">
            Template features
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              "Validator delegation",
              "Dynamic APR (7–12%)",
              "Commission system",
              "Saturation limits",
              "Reward per second",
              "24h unstake delay",
              "On-chain metadata",
              "Rewards treasury",
              "Role-based admin",
            ].map((feat, i) => (
              <motion.div
                key={feat}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55 + i * 0.04 }}
                className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"
              >
                <span className="text-[var(--text-muted)]">&#10003;</span>
                {feat}
              </motion.div>
            ))}
          </div>
        </motion.section>

        {stakeModalValidator !== null && (
          <StakeModal
            validatorId={stakeModalValidator}
            onClose={() => setStakeModalValidator(null)}
          />
        )}
        {manageModalValidator !== null && (
          <ManageModalWithData
            validatorId={manageModalValidator}
            validatorIds={validatorIds}
            onClose={() => setManageModalValidator(null)}
          />
        )}
        {showRegisterModal && (
          <RegisterValidatorModal
            whitelisted={whitelisted ?? false}
            onClose={() => setShowRegisterModal(false)}
          />
        )}
        {showRewardCalc && (
          <RewardCalculatorModal onClose={() => setShowRewardCalc(false)} />
        )}
      </main>

      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="relative z-10 px-6 py-6 lg:px-10 border-t border-[var(--border-subtle)]"
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between text-[10px] text-[var(--text-muted)] uppercase tracking-widest">
          <span>Redbelly Shared Node Staking</span>
          <span>Template - Reference Implementation - Not Audited</span>
        </div>
      </motion.footer>
    </div>
  );
}

function ValidatorCardWithUserData({
  validatorId,
  index,
  onStake,
  onManage,
}: {
  validatorId: number;
  index: number;
  onStake: () => void;
  onManage: () => void;
}) {
  const { amount, delegatorShare, pendingUnstakeAmount, pendingUnstakeUnlockAt } = useUserDelegation(validatorId);
  return (
    <ValidatorCard
      validatorId={validatorId}
      index={index}
      onStake={onStake}
      onManage={onManage}
      userDelegation={amount}
      userEarnedDelegatorShare={delegatorShare}
    />
  );
}

function ManageModalWithData({
  validatorId,
  validatorIds,
  onClose,
}: {
  validatorId: number;
  validatorIds: number[];
  onClose: () => void;
}) {
  const { amount, delegatorShare, pendingUnstakeAmount, pendingUnstakeUnlockAt } = useUserDelegation(validatorId);
  const otherValidatorIds = validatorIds.filter((id) => id !== validatorId);
  return (
    <ManageModal
      validatorId={validatorId}
      userStake={amount}
      pendingUnstakeAmount={pendingUnstakeAmount}
      pendingUnstakeUnlockAt={pendingUnstakeUnlockAt}
      earnedDelegatorShare={delegatorShare}
      otherValidatorIds={otherValidatorIds}
      onClose={onClose}
    />
  );
}

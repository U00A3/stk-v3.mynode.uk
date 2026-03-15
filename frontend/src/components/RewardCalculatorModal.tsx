"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useReadContract } from "wagmi";
import { parseUnits } from "viem";
import { ADDRESSES, STAKING_ABI } from "@/lib/contracts";
import { formatToken } from "@/lib/utils";

const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_YEAR = 31_536_000;

interface RewardCalculatorModalProps {
  onClose: () => void;
}

export default function RewardCalculatorModal({ onClose }: RewardCalculatorModalProps) {
  const [amount, setAmount] = useState("");
  const [commissionInput, setCommissionInput] = useState("5");

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

  const stakeAmountWei = useMemo(() => {
    if (!amount || amount === ".") return 0n;
    try {
      return parseUnits(amount.replace(/^\./, "0."), 18);
    } catch {
      return 0n;
    }
  }, [amount]);

  const commissionBps = Math.min(Math.max(Math.round(parseFloat(commissionInput || "0") * 100), 0), 2000);

  const simulation = useMemo(() => {
    if (stakeAmountWei === 0n) return null;

    const apr = aprBps !== undefined ? Number(aprBps) : 700;
    const grossPerYear = (stakeAmountWei * BigInt(apr)) / 10_000n;
    const commission = (grossPerYear * BigInt(commissionBps)) / 10_000n;
    const netPerYear = grossPerYear - commission;
    const netPerDay = netPerYear / BigInt(SECONDS_PER_YEAR) * BigInt(SECONDS_PER_DAY);
    const netPerMonth = netPerYear / 12n;
    const effectiveApr = apr * (10_000 - commissionBps) / 10_000;

    return {
      grossPerYear,
      netPerYear,
      netPerDay,
      netPerMonth,
      commission,
      aprPercent: apr / 100,
      effectiveAprPercent: effectiveApr / 100,
    };
  }, [stakeAmountWei, aprBps, commissionBps]);

  return (
    <AnimatePresence>
      <div className="modal-overlay" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="glass-card p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold">Reward Calculator</h2>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-lg leading-none"
            >
              &times;
            </button>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--border-subtle)] p-3 space-y-2 bg-[var(--bg-primary)]/50">
              <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                Current network data
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-[var(--text-muted)]">Total staked: </span>
                  <span className="mono text-[var(--text-secondary)]">
                    {formatToken(totalStaked ?? 0n)}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Target APR: </span>
                  <span className="mono text-[var(--text-secondary)]">
                    {aprBps !== undefined ? `${Number(aprBps) / 100}%` : "7%"}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Rate: </span>
                  <span className="mono text-[var(--text-secondary)]">
                    {formatToken(rewardRate ?? 0n)} /s
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
                Amount to stake
              </label>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 10000"
                inputMode="decimal"
                className="input-field w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  Validator commission
                </label>
                <span className="text-[10px] text-[var(--text-muted)]">Max 20%</span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={commissionInput}
                  onChange={(e) => setCommissionInput(e.target.value)}
                  placeholder="5"
                  className="input-field w-full pr-10"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm">%</span>
              </div>
            </div>

            {simulation && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border border-[var(--border-medium)] p-4 space-y-3 bg-[var(--bg-secondary)]/80"
              >
                <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  Estimated rewards
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-muted)]">Per day</span>
                    <span className="mono text-[var(--text-primary)]">{formatToken(simulation.netPerDay)} RWD</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-muted)]">Per month</span>
                    <span className="mono text-[var(--text-primary)]">{formatToken(simulation.netPerMonth)} RWD</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-muted)]">Per year</span>
                    <span className="mono text-[var(--text-primary)]">{formatToken(simulation.netPerYear)} RWD</span>
                  </div>
                  <div className="border-t border-[var(--border-subtle)] pt-2 mt-2 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--text-muted)]">Gross APR</span>
                      <span className="mono text-[var(--text-secondary)]">{simulation.aprPercent}%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--text-muted)]">Commission ({commissionBps / 100}%)</span>
                      <span className="mono text-[var(--text-secondary)]">−{formatToken(simulation.commission)} /yr</span>
                    </div>
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-[var(--text-muted)]">Effective APR</span>
                      <span className="mono text-[var(--text-primary)]">{simulation.effectiveAprPercent}%</span>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-[var(--text-muted)] mt-2 leading-relaxed">
                  APR is dynamic (target {simulation.aprPercent}%, max 12%). Rate resyncs on stake/unstake.
                  Actual rewards depend on treasury balance and network activity.
                </p>
              </motion.div>
            )}
          </div>

          <div className="mt-5 pt-4 border-t border-[var(--border-subtle)]">
            <button type="button" className="btn-ghost w-full text-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { ADDRESSES, STAKING_ABI, ERC20_ABI } from "@/lib/contracts";
import { formatToken } from "@/lib/utils";
import { useTxRateLimit } from "@/hooks/useTxRateLimit";

interface StakeModalProps {
  validatorId: number;
  onClose: () => void;
}

export default function StakeModal({ validatorId, onClose }: StakeModalProps) {
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"input" | "approving" | "staking" | "done">("input");
  const { canSend: canSendStake, recordSend: recordStake, cooldownRemaining: stakeCooldown } = useTxRateLimit("stake");
  const { canSend: canSendApprove, recordSend: recordApprove, cooldownRemaining: approveCooldown } = useTxRateLimit("approve");

  const { data: tokenBalance } = useReadContract({
    address: ADDRESSES.STAKING_TOKEN,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: allowance } = useReadContract({
    address: ADDRESSES.STAKING_TOKEN,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, ADDRESSES.STAKING] : undefined,
    query: { enabled: !!address },
  });

  const { data: saturationData } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "getSaturationForValidator",
    args: [BigInt(validatorId)],
  });

  const maxAvailable = saturationData
    ? ((saturationData as [bigint, bigint])[1] - (saturationData as [bigint, bigint])[0])
    : undefined;

  const effectiveMax = (() => {
    if (maxAvailable === undefined || maxAvailable < 0n) return 0n;
    const balance = (tokenBalance as bigint) ?? 0n;
    return maxAvailable < balance ? maxAvailable : balance;
  })();

  const { writeContract: approve, data: approveTx, isError: isApproveError, reset: resetApprove } = useWriteContract();
  const { writeContract: stake, data: stakeTx, isError: isStakeError, reset: resetStake } = useWriteContract();

  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTx });
  const { isSuccess: stakeConfirmed } = useWaitForTransactionReceipt({ hash: stakeTx });

  useEffect(() => {
    if (step === "approving" && isApproveError) {
      setStep("input");
      resetApprove();
    }
  }, [step, isApproveError, resetApprove]);

  useEffect(() => {
    if (step === "staking" && isStakeError) {
      setStep("input");
      resetStake();
    }
  }, [step, isStakeError, resetStake]);

  const parsedAmount = amount ? parseUnits(amount, 18) : 0n;
  const needsApproval = parsedAmount > 0n && (allowance === undefined || parsedAmount > (allowance as bigint));

  const handleApprove = () => {
    if (!canSendApprove) return;
    setStep("approving");
    recordApprove();
    approve({
      address: ADDRESSES.STAKING_TOKEN,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [ADDRESSES.STAKING, parsedAmount],
    });
  };

  const handleStake = () => {
    if (!canSendStake) return;
    setStep("staking");
    recordStake();
    stake({
      address: ADDRESSES.STAKING,
      abi: STAKING_ABI,
      functionName: "stake",
      args: [BigInt(validatorId), parsedAmount],
    });
  };

  useEffect(() => {
    if (!approveConfirmed || step !== "approving" || !amount) return;
    const amt = parseUnits(amount, 18);
    stake({
      address: ADDRESSES.STAKING,
      abi: STAKING_ABI,
      functionName: "stake",
      args: [BigInt(validatorId), amt],
    });
    setStep("staking");
  }, [approveConfirmed, step, amount, validatorId, stake]);

  useEffect(() => {
    if (stakeConfirmed && step === "staking") setStep("done");
  }, [stakeConfirmed, step]);

  const setMax = () => {
    if (effectiveMax > 0n) setAmount(formatUnits(effectiveMax, 18));
  };

  const exceedsSaturation = parsedAmount > 0n && maxAvailable !== undefined && parsedAmount > maxAvailable;

  return (
    <AnimatePresence>
      <div className="modal-overlay" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="glass-card p-6 w-full max-w-md mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold">Stake - Validator #{validatorId}</h2>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-lg"
            >
              &times;
            </button>
          </div>

          {step === "done" ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-8"
            >
              <div className="text-3xl mb-3">&#10003;</div>
              <p className="text-sm text-[var(--text-secondary)]">
                Successfully staked {amount} tokens
              </p>
              <button className="btn-primary mt-5" onClick={onClose}>
                Close
              </button>
            </motion.div>
          ) : (
            <>
              <div className="flex flex-col gap-1 mb-4">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                    Amount
                  </label>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    Balance: {formatToken((tokenBalance as bigint) ?? 0n)}
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.0"
                    className="input-field pr-16"
                    disabled={step !== "input"}
                  />
                  <button
                    type="button"
                    onClick={setMax}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border-subtle)] rounded px-2 py-0.5"
                  >
                    Max
                  </button>
                </div>
              </div>

              {maxAvailable !== undefined && (
                <div className={`rounded-lg px-3 py-2 mb-4 text-xs ${
                  exceedsSaturation
                    ? "bg-red-500/10 border border-red-500/20"
                    : "bg-[var(--bg-card)]/50 border border-[var(--border-subtle)]"
                }`}>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--text-muted)]">Available capacity</span>
                    <span className={exceedsSaturation ? "text-red-400 font-medium" : "text-[var(--text-secondary)]"}>
                      {formatToken(maxAvailable > 0n ? maxAvailable : 0n)} STK
                    </span>
                  </div>
                  {exceedsSaturation && (
                    <p className="text-red-400/80 mt-1 text-[10px]">
                      Amount exceeds saturation limit for this validator
                    </p>
                  )}
                </div>
              )}

              {step === "input" && (
                <div className="flex gap-2">
                  {needsApproval ? (
                    <button
                      className={`btn-primary flex-1 ${!canSendApprove ? "opacity-50 cursor-not-allowed" : ""}`}
                      onClick={handleApprove}
                      disabled={!amount || parsedAmount === 0n || exceedsSaturation || !canSendApprove}
                      title={!canSendApprove && approveCooldown > 0 ? `Rate limit: wait ${approveCooldown}s` : undefined}
                    >
                      {!canSendApprove && approveCooldown > 0 ? `Wait ${approveCooldown}s` : "Approve & Stake"}
                    </button>
                  ) : (
                    <button
                      className={`btn-primary flex-1 ${!canSendStake ? "opacity-50 cursor-not-allowed" : ""}`}
                      onClick={handleStake}
                      disabled={!amount || parsedAmount === 0n || exceedsSaturation || !canSendStake}
                      title={!canSendStake && stakeCooldown > 0 ? `Rate limit: wait ${stakeCooldown}s` : undefined}
                    >
                      {!canSendStake && stakeCooldown > 0 ? `Wait ${stakeCooldown}s` : "Stake"}
                    </button>
                  )}
                </div>
              )}

              {(step === "approving" || step === "staking") && (
                <div className="flex items-center justify-center gap-2 py-3">
                  <div className="w-4 h-4 border-2 border-[var(--border-bright)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-[var(--text-secondary)]">
                    {step === "approving" ? "Approving..." : "Staking..."}
                  </span>
                </div>
              )}
            </>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

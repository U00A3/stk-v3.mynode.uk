"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { ADDRESSES, STAKING_ABI } from "@/lib/contracts";
import { formatToken, formatCountdown } from "@/lib/utils";
import { useTxRateLimit } from "@/hooks/useTxRateLimit";
import { useRedelegateValidators } from "@/hooks/useRedelegateValidators";
import ValidatorSelect from "@/components/ValidatorSelect";

interface ManageModalProps {
  validatorId: number;
  userStake: bigint;
  pendingUnstakeAmount: bigint;
  pendingUnstakeUnlockAt: bigint;
  earnedDelegatorShare: bigint;
  /** Validator IDs the user can redelegate to (excluding current). */
  otherValidatorIds: number[];
  onClose: () => void;
}

export default function ManageModal({
  validatorId,
  userStake,
  pendingUnstakeAmount,
  pendingUnstakeUnlockAt,
  earnedDelegatorShare,
  otherValidatorIds,
  onClose,
}: ManageModalProps) {
  const [unstakeAmount, setUnstakeAmount] = useState("");
  const [redelegateToId, setRedelegateToId] = useState<number | null>(null);
  const [redelegateAmount, setRedelegateAmount] = useState("");
  const [showRedelegateFlow, setShowRedelegateFlow] = useState(false);
  const redelegateValidators = useRedelegateValidators(otherValidatorIds);
  const [action, setAction] = useState<"idle" | "unstaking" | "withdrawing" | "claiming" | "redelegating" | "done">("idle");
  const [doneMessage, setDoneMessage] = useState("");
  const { canSend: canSendUnstake, recordSend: recordUnstake, cooldownRemaining: unstakeCooldown } = useTxRateLimit("unstake");
  const { canSend: canSendWithdraw, recordSend: recordWithdraw, cooldownRemaining: withdrawCooldown } = useTxRateLimit("withdraw");
  const { canSend: canSendClaim, recordSend: recordClaim, cooldownRemaining: claimCooldown } = useTxRateLimit("claim");
  const { canSend: canSendRedelegate, recordSend: recordRedelegate, cooldownRemaining: redelegateCooldown } = useTxRateLimit("redelegate");

  const { writeContract: unstake, data: unstakeTx, isError: isUnstakeError, reset: resetUnstake } = useWriteContract();
  const { writeContract: withdraw, data: withdrawTx, isError: isWithdrawError, reset: resetWithdraw } = useWriteContract();
  const { writeContract: claimReward, data: claimTx, isError: isClaimError, reset: resetClaim } = useWriteContract();
  const { writeContract: redelegate, data: redelegateTx, isError: isRedelegateError, reset: resetRedelegate } = useWriteContract();

  const { isSuccess: unstakeOk } = useWaitForTransactionReceipt({ hash: unstakeTx });
  const { isSuccess: withdrawOk } = useWaitForTransactionReceipt({ hash: withdrawTx });
  const { isSuccess: claimOk } = useWaitForTransactionReceipt({ hash: claimTx });
  const { isSuccess: redelegateOk } = useWaitForTransactionReceipt({ hash: redelegateTx });

  useEffect(() => {
    if (action === "unstaking" && isUnstakeError) {
      setAction("idle");
      resetUnstake();
    }
  }, [action, isUnstakeError, resetUnstake]);
  useEffect(() => {
    if (action === "withdrawing" && isWithdrawError) {
      setAction("idle");
      resetWithdraw();
    }
  }, [action, isWithdrawError, resetWithdraw]);
  useEffect(() => {
    if (action === "claiming" && isClaimError) {
      setAction("idle");
      resetClaim();
    }
  }, [action, isClaimError, resetClaim]);
  useEffect(() => {
    if (action === "redelegating" && isRedelegateError) {
      setAction("idle");
      resetRedelegate();
    }
  }, [action, isRedelegateError, resetRedelegate]);

  useEffect(() => {
    if (unstakeOk && action === "unstaking") {
      setAction("done");
      setDoneMessage("Unstake requested. Withdraw available after 24h.");
    }
  }, [unstakeOk, action]);
  useEffect(() => {
    if (withdrawOk && action === "withdrawing") {
      setAction("done");
      setDoneMessage("Tokens withdrawn.");
    }
  }, [withdrawOk, action]);
  useEffect(() => {
    if (claimOk && action === "claiming") {
      setAction("done");
      setDoneMessage("Rewards claimed.");
    }
  }, [claimOk, action]);
  useEffect(() => {
    if (redelegateOk && action === "redelegating") {
      setAction("done");
      setDoneMessage(`Redelegated to validator #${redelegateToId}.`);
    }
  }, [redelegateOk, action, redelegateToId]);

  const parsedUnstake = unstakeAmount ? parseUnits(unstakeAmount, 18) : 0n;
  const now = Math.floor(Date.now() / 1000);
  const isUnlockPending = Number(pendingUnstakeUnlockAt) > now;
  const countdown = formatCountdown(Number(pendingUnstakeUnlockAt));

  const handleUnstake = () => {
    if (!canSendUnstake) return;
    setAction("unstaking");
    recordUnstake();
    unstake({
      address: ADDRESSES.STAKING,
      abi: STAKING_ABI,
      functionName: "unstake",
      args: [BigInt(validatorId), parsedUnstake],
    });
  };

  const handleWithdraw = () => {
    if (!canSendWithdraw) return;
    setAction("withdrawing");
    recordWithdraw();
    withdraw({
      address: ADDRESSES.STAKING,
      abi: STAKING_ABI,
      functionName: "withdraw",
      args: [BigInt(validatorId)],
    });
  };

  const handleClaim = () => {
    if (!canSendClaim) return;
    setAction("claiming");
    recordClaim();
    claimReward({
      address: ADDRESSES.STAKING,
      abi: STAKING_ABI,
      functionName: "claimReward",
      args: [BigInt(validatorId)],
    });
  };

  const setMaxUnstake = () => setUnstakeAmount(formatUnits(userStake, 18));

  const { data: targetSaturation } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "getSaturationForValidator",
    args: redelegateToId != null ? [BigInt(redelegateToId)] : undefined,
    query: { enabled: redelegateToId != null },
  });
  const [targetDelegated, targetCap] = targetSaturation ?? [0n, 0n];
  const targetAvailable = targetCap > targetDelegated ? targetCap - targetDelegated : 0n;
  const maxRedelegate = userStake < targetAvailable ? userStake : targetAvailable;

  let parsedRedelegate = 0n;
  try {
    parsedRedelegate = redelegateAmount ? parseUnits(redelegateAmount, 18) : 0n;
  } catch {
    // invalid input
  }
  const setMaxRedelegate = () => setRedelegateAmount(formatUnits(maxRedelegate, 18));

  const handleRedelegate = () => {
    if (!canSendRedelegate || redelegateToId == null) return;
    setAction("redelegating");
    recordRedelegate();
    redelegate({
      address: ADDRESSES.STAKING,
      abi: STAKING_ABI,
      functionName: "redelegate",
      args: [BigInt(validatorId), BigInt(redelegateToId), parsedRedelegate],
    });
  };

  const isPending = action === "unstaking" || action === "withdrawing" || action === "claiming" || action === "redelegating";

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
            <h2 className="text-base font-semibold">Manage - Validator #{validatorId}</h2>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-lg"
            >
              &times;
            </button>
          </div>

          {action === "done" ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-8"
            >
              <div className="text-3xl mb-3">&#10003;</div>
              <p className="text-sm text-[var(--text-secondary)]">{doneMessage}</p>
              <button className="btn-primary mt-5" onClick={onClose}>
                Close
              </button>
            </motion.div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Staked</span>
                  <p className="mono text-sm text-[var(--text-secondary)]">{formatToken(userStake)}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Pending rewards</span>
                  <p className="mono text-sm text-[var(--text-primary)]">{formatToken(earnedDelegatorShare)}</p>
                </div>
              </div>

              {pendingUnstakeAmount > 0n && (
                <div className="flex items-center justify-between py-2 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]">
                  <span className="text-xs text-[var(--text-secondary)]">
                    Pending withdraw: {formatToken(pendingUnstakeAmount)}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {isUnlockPending ? countdown : "Unlocked"}
                  </span>
                </div>
              )}

              <button
                className={`btn-primary w-full ${!canSendClaim && claimCooldown > 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                onClick={handleClaim}
                disabled={isPending || earnedDelegatorShare === 0n || !canSendClaim}
                title={!canSendClaim && claimCooldown > 0 ? `Rate limit: wait ${claimCooldown}s` : undefined}
              >
                {!canSendClaim && claimCooldown > 0 ? `Wait ${claimCooldown}s` : "Claim Rewards"}
              </button>

              <div className="border-t border-[var(--border-subtle)] pt-4">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                    Unstake amount
                  </label>
                  <button
                    type="button"
                    onClick={setMaxUnstake}
                    className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  >
                    Max
                  </button>
                </div>
                <input
                  type="text"
                  value={unstakeAmount}
                  onChange={(e) => setUnstakeAmount(e.target.value)}
                  placeholder="0.0"
                  className="input-field mb-2"
                  disabled={isPending}
                />
                <button
                  className={`btn-ghost w-full ${!canSendUnstake && unstakeCooldown > 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                  onClick={handleUnstake}
                  disabled={isPending || !unstakeAmount || parsedUnstake === 0n || parsedUnstake > userStake || !canSendUnstake}
                  title={!canSendUnstake && unstakeCooldown > 0 ? `Rate limit: wait ${unstakeCooldown}s` : undefined}
                >
                  {!canSendUnstake && unstakeCooldown > 0 ? `Wait ${unstakeCooldown}s` : "Request Unstake (24h delay)"}
                </button>
              </div>

              {otherValidatorIds.length > 0 && (
                <div className="border-t border-[var(--border-subtle)] pt-4">
                  <button
                    type="button"
                    onClick={() => setShowRedelegateFlow((v) => !v)}
                    className="flex items-center justify-between w-full text-left py-1"
                  >
                    <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                      Redelegate to another validator
                    </span>
                    <span className="text-[var(--text-muted)] text-lg leading-none">
                      {showRedelegateFlow ? "−" : "+"}
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {showRedelegateFlow && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="flow-pipeline flow-pipeline-full mt-4">
                          <div className="flow-stage glass-card px-3 py-2.5 w-full">
                            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest block mb-1.5">1. Target validator</span>
                            <ValidatorSelect
                              validators={redelegateValidators}
                              value={
                                redelegateToId != null
                                  ? redelegateValidators.find((v) => v.id === redelegateToId)?.address ?? null
                                  : null
                              }
                              onChange={(address) => {
                                const v = redelegateValidators.find((x) => x.address === address);
                                setRedelegateToId(v ? v.id : null);
                                setRedelegateAmount("");
                              }}
                              disabled={isPending}
                              placeholder="Select validator"
                            />
                            <p className="text-[10px] text-[var(--text-muted)] mt-1.5">Your stake: {formatToken(userStake)} STK</p>
                          </div>
                          <div className="flow-arrow" style={{ height: 40 }}>
                            <div className="arrow-line" />
                            <div className="arrow-head" />
                            <span className="arrow-label">amount</span>
                          </div>
                          <div className="flow-stage glass-card px-3 py-2.5 w-full">
                            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest block mb-1.5">2. Amount</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={redelegateAmount}
                                onChange={(e) => setRedelegateAmount(e.target.value)}
                                placeholder="0.0"
                                className="input-field flex-1 min-w-0 text-sm py-2"
                                disabled={isPending || redelegateToId == null}
                              />
                              <button
                                type="button"
                                onClick={setMaxRedelegate}
                                disabled={redelegateToId == null || isPending}
                                className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)] whitespace-nowrap px-2 py-1.5 border border-[var(--border-subtle)] rounded disabled:opacity-50"
                              >
                                Max
                              </button>
                            </div>
                            {redelegateToId != null && (
                              <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
                                Available at target: {formatToken(targetAvailable)} STK
                              </p>
                            )}
                          </div>
                          <div className="flow-arrow" style={{ height: 40 }}>
                            <div className="arrow-line" />
                            <div className="arrow-head" />
                            <span className="arrow-label">send</span>
                          </div>
                          <div className="flow-stage glass-card px-3 py-2.5 w-full">
                            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest block mb-1.5">3. Redelegate</span>
                            <button
                              className={`btn-primary w-full text-sm py-2 ${!canSendRedelegate && redelegateCooldown > 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                              onClick={handleRedelegate}
                              disabled={
                                isPending ||
                                !redelegateAmount ||
                                parsedRedelegate === 0n ||
                                parsedRedelegate > userStake ||
                                parsedRedelegate > targetAvailable ||
                                !canSendRedelegate
                              }
                              title={!canSendRedelegate && redelegateCooldown > 0 ? `Rate limit: wait ${redelegateCooldown}s` : undefined}
                            >
                              {!canSendRedelegate && redelegateCooldown > 0 ? `Wait ${redelegateCooldown}s` : "Redelegate"}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {pendingUnstakeAmount > 0n && !isUnlockPending && (
                <button
                  className={`btn-primary w-full ${!canSendWithdraw && withdrawCooldown > 0 ? "opacity-50 cursor-not-allowed" : ""}`}
                  onClick={handleWithdraw}
                  disabled={isPending || !canSendWithdraw}
                  title={!canSendWithdraw && withdrawCooldown > 0 ? `Rate limit: wait ${withdrawCooldown}s` : undefined}
                >
                  {!canSendWithdraw && withdrawCooldown > 0 ? `Wait ${withdrawCooldown}s` : `Withdraw ${formatToken(pendingUnstakeAmount)}`}
                </button>
              )}

              {isPending && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <div className="w-4 h-4 border-2 border-[var(--border-bright)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-[var(--text-secondary)]">Confirming...</span>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

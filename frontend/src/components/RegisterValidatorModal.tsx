"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { ADDRESSES, STAKING_ABI, ERC20_ABI } from "@/lib/contracts";
import { formatToken } from "@/lib/utils";
import { useTxRateLimit } from "@/hooks/useTxRateLimit";

interface RegisterValidatorModalProps {
  whitelisted: boolean;
  onClose: () => void;
}

export default function RegisterValidatorModal({ whitelisted, onClose }: RegisterValidatorModalProps) {
  const { address } = useAccount();
  const [commissionPercent, setCommissionPercent] = useState("5");
  const [selfStakeAmount, setSelfStakeAmount] = useState("");
  const [step, setStep] = useState<"input" | "approving" | "registering" | "saving_meta" | "done">("input");

  const [metaName, setMetaName] = useState("");
  const [metaWebsite, setMetaWebsite] = useState("");
  const [metaTwitter, setMetaTwitter] = useState("");
  const [metaGithub, setMetaGithub] = useState("");
  const [metaTelegram, setMetaTelegram] = useState("");
  const [metaDiscord, setMetaDiscord] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [metaAvatarUrl, setMetaAvatarUrl] = useState("");

  const { canSend: canSendApprove, recordSend: recordApprove, cooldownRemaining: approveCooldown } = useTxRateLimit("approve");
  const { canSend: canSendRegister, recordSend: recordRegister, cooldownRemaining: registerCooldown } = useTxRateLimit("register");

  const { data: minSelfStake } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "minSelfStake",
  });

  const { data: maxCommissionBps } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "MAX_COMMISSION_BPS",
  });

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

  const { data: operatorValId, refetch: refetchValId } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "operatorToValidatorId",
    args: address ? [address] : undefined,
    query: { enabled: false },
  });

  const { writeContract: approve, data: approveTx } = useWriteContract();
  const { writeContract: register, data: registerTx } = useWriteContract();
  const { writeContract: saveMeta, data: metaTx } = useWriteContract();

  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTx });
  const { isSuccess: registerConfirmed } = useWaitForTransactionReceipt({ hash: registerTx });
  const { isSuccess: metaConfirmed } = useWaitForTransactionReceipt({ hash: metaTx });

  const DEFAULT_MIN_SELF_STAKE = parseUnits("50000", 18);
  const effectiveMinSelfStake = minSelfStake ?? DEFAULT_MIN_SELF_STAKE;
  const effectiveMaxCommission = maxCommissionBps ?? 2000n;

  const commissionBps = Math.min(
    Math.max(Math.round(parseFloat(commissionPercent || "0") * 100), 0),
    Number(effectiveMaxCommission)
  );
  const maxCommissionPercent = Number(effectiveMaxCommission) / 100;
  const parsedSelfStake = selfStakeAmount ? parseUnits(selfStakeAmount, 18) : 0n;
  const needsApproval = parsedSelfStake > 0n && (allowance === undefined || parsedSelfStake > (allowance as bigint));
  const minSelfStakeFormatted = formatToken(effectiveMinSelfStake);
  const meetsMinSelfStake = parsedSelfStake >= effectiveMinSelfStake;

  const handleApprove = () => {
    if (!canSendApprove) return;
    setStep("approving");
    recordApprove();
    approve({
      address: ADDRESSES.STAKING_TOKEN,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [ADDRESSES.STAKING, parsedSelfStake],
    });
  };

  const doRegister = () => {
    if (!whitelisted || !canSendRegister) return;
    setStep("registering");
    recordRegister();
    const amt = selfStakeAmount ? parseUnits(selfStakeAmount, 18) : 0n;
    register({
      address: ADDRESSES.STAKING,
      abi: STAKING_ABI,
      functionName: "registerValidator",
      args: [commissionBps, amt],
    });
  };

  useEffect(() => {
    if (!approveConfirmed || step !== "approving") return;
    doRegister();
  }, [approveConfirmed, step]);

  const hasMeta = metaName || metaWebsite || metaTwitter || metaGithub || metaTelegram || metaDiscord || metaDescription || metaAvatarUrl;

  useEffect(() => {
    if (!registerConfirmed || step !== "registering") return;
    if (!hasMeta) {
      setStep("done");
      return;
    }
    setStep("saving_meta");
    refetchValId().then(({ data: valId }) => {
      if (!valId || valId === 0n) return;
      saveMeta({
        address: ADDRESSES.STAKING,
        abi: STAKING_ABI,
        functionName: "setValidatorMeta",
        args: [valId, {
          name: metaName,
          website: metaWebsite,
          twitter: metaTwitter,
          github: metaGithub,
          email: metaTelegram,
          chat: metaDiscord,
          description: metaDescription,
          avatarUrl: metaAvatarUrl,
        }],
      });
    });
  }, [registerConfirmed, step]);

  useEffect(() => {
    if (metaConfirmed && step === "saving_meta") setStep("done");
  }, [metaConfirmed, step]);

  const setMax = () => {
    if (tokenBalance) setSelfStakeAmount((Number(tokenBalance) / 1e18).toString());
  };

  const setMin = () => {
    if (minSelfStake) setSelfStakeAmount((Number(minSelfStake) / 1e18).toString());
  };

  const canSubmit = selfStakeAmount && parsedSelfStake > 0n && meetsMinSelfStake && commissionBps >= 0;

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
            <h2 className="text-base font-semibold">Register as Validator</h2>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-lg"
            >
              &times;
            </button>
          </div>

          {!whitelisted && (
            <div className="mb-4 p-3 rounded-lg bg-[#cc6666]/15 border border-[#cc6666]/40 text-[11px] text-[#cc6666]">
              Your address is not on the validator whitelist. Contact the admin to get approved.
            </div>
          )}

          {step === "done" ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-8"
            >
              <div className="text-3xl mb-3">&#10003;</div>
              <p className="text-sm text-[var(--text-secondary)]">
                Validator registered successfully
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Commission: {commissionPercent}% &middot; Self-stake: {selfStakeAmount}
              </p>
              <button className="btn-primary mt-5" onClick={onClose}>
                Close
              </button>
            </motion.div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Commission */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                    Commission (%)
                  </label>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    Max {maxCommissionPercent}%
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={commissionPercent}
                    onChange={(e) => setCommissionPercent(e.target.value)}
                    placeholder="5"
                    className="input-field pr-10"
                    disabled={step !== "input"}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm">
                    %
                  </span>
                </div>
                {parseFloat(commissionPercent) > maxCommissionPercent && (
                  <span className="text-[10px] text-[#cc6666]">
                    Max commission is {maxCommissionPercent}%
                  </span>
                )}
              </div>

              {/* Self-stake */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                    Self-stake amount
                  </label>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    Balance: {formatToken((tokenBalance as bigint) ?? 0n)}
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={selfStakeAmount}
                    onChange={(e) => setSelfStakeAmount(e.target.value)}
                    placeholder="0.0"
                    className="input-field pr-24"
                    disabled={step !== "input"}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1">
                    <button
                      type="button"
                      onClick={setMin}
                      className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border-subtle)] rounded px-2 py-0.5"
                    >
                      Min
                    </button>
                    <button
                      type="button"
                      onClick={setMax}
                      className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border-subtle)] rounded px-2 py-0.5"
                    >
                      Max
                    </button>
                  </div>
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">
                  Minimum: {minSelfStakeFormatted}
                </span>
                {selfStakeAmount && parsedSelfStake > 0n && !meetsMinSelfStake && (
                  <span className="text-[10px] text-[#cc6666]">
                    Below minimum self-stake requirement
                  </span>
                )}
              </div>

              {/* Metadata (optional) */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  Validator Profile <span className="normal-case">(optional)</span>
                </label>
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Name</label>
                      <span className="text-[10px] text-[var(--text-muted)]">{metaName.length}/20</span>
                    </div>
                    <input
                      type="text"
                      value={metaName}
                      onChange={(e) => { if (e.target.value.length <= 20) setMetaName(e.target.value); }}
                      placeholder="Your validator name"
                      className="input-field"
                      disabled={step !== "input"}
                      maxLength={20}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1 block">Website</label>
                    <input
                      type="text"
                      value={metaWebsite}
                      onChange={(e) => setMetaWebsite(e.target.value)}
                      placeholder="https://example.com"
                      className="input-field"
                      disabled={step !== "input"}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1 block">Redbelly Discord</label>
                      <input
                        type="text"
                        value={metaDiscord}
                        onChange={(e) => setMetaDiscord(e.target.value)}
                        placeholder="your_username"
                        className="input-field"
                        disabled={step !== "input"}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1 block">Telegram</label>
                      <input
                        type="text"
                        value={metaTelegram}
                        onChange={(e) => setMetaTelegram(e.target.value)}
                        placeholder="@handle"
                        className="input-field"
                        disabled={step !== "input"}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1 block">X / Twitter</label>
                      <input
                        type="text"
                        value={metaTwitter}
                        onChange={(e) => setMetaTwitter(e.target.value)}
                        placeholder="@handle"
                        className="input-field"
                        disabled={step !== "input"}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1 block">GitHub</label>
                      <input
                        type="text"
                        value={metaGithub}
                        onChange={(e) => setMetaGithub(e.target.value)}
                        placeholder="username"
                        className="input-field"
                        disabled={step !== "input"}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1 block">Avatar URL</label>
                    <input
                      type="text"
                      value={metaAvatarUrl}
                      onChange={(e) => setMetaAvatarUrl(e.target.value)}
                      placeholder="https://...image.png"
                      className="input-field"
                      disabled={step !== "input"}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Motto</label>
                      <span className="text-[10px] text-[var(--text-muted)]">{metaDescription.length}/60</span>
                    </div>
                    <textarea
                      value={metaDescription}
                      onChange={(e) => { if (e.target.value.length <= 60) setMetaDescription(e.target.value); }}
                      placeholder="Short description or motto"
                      rows={2}
                      className="input-field resize-none"
                      disabled={step !== "input"}
                      maxLength={60}
                    />
                  </div>
                </div>
              </div>

              {/* Info */}
              <div className="py-2 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]">
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  Self-stake will be locked as your initial delegation. Delegators can then stake with your validator. Commission is taken from delegator rewards.
                </p>
              </div>

              {step === "input" && (
                <div className="flex gap-2">
                  {needsApproval ? (
                    <button
                      className={`btn-primary flex-1 ${!whitelisted || !canSendApprove ? "opacity-50 cursor-not-allowed" : ""}`}
                      onClick={handleApprove}
                      disabled={!canSubmit || !whitelisted || !canSendApprove}
                      title={!canSendApprove && approveCooldown > 0 ? `Rate limit: wait ${approveCooldown}s` : undefined}
                    >
                      {!canSendApprove && approveCooldown > 0 ? `Wait ${approveCooldown}s` : "Approve & Register"}
                    </button>
                  ) : (
                    <button
                      className={`btn-primary flex-1 ${!whitelisted || !canSendRegister ? "opacity-50 cursor-not-allowed" : ""}`}
                      onClick={doRegister}
                      disabled={!canSubmit || !whitelisted || !canSendRegister}
                      title={!canSendRegister && registerCooldown > 0 ? `Rate limit: wait ${registerCooldown}s` : undefined}
                    >
                      {!canSendRegister && registerCooldown > 0 ? `Wait ${registerCooldown}s` : "Register Validator"}
                    </button>
                  )}
                </div>
              )}

              {(step === "approving" || step === "registering" || step === "saving_meta") && (
                <div className="flex items-center justify-center gap-2 py-3">
                  <div className="w-4 h-4 border-2 border-[var(--border-bright)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-[var(--text-secondary)]">
                    {step === "approving" ? "Approving..." : step === "registering" ? "Registering..." : "Saving profile..."}
                  </span>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

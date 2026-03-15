"use client";

import { motion } from "framer-motion";
import { useAccount, useReadContract } from "wagmi";
import { ADDRESSES, STAKING_ABI } from "@/lib/contracts";
import { formatToken, shortenAddress, commissionBpsToPercent } from "@/lib/utils";
import { useCatStatus } from "@/hooks/useCatStatus";
import ValidatorAvatar from "./ValidatorAvatar";

export type ValidatorData = {
  operator: string;
  commissionBps: number;
  selfStake: bigint;
  totalStake: bigint;
  active: boolean;
};

interface ValidatorCardProps {
  validatorId: number;
  index: number;
  onStake: () => void;
  onManage: () => void;
  userDelegation: bigint;
  userEarnedDelegatorShare: bigint;
}

export default function ValidatorCard({
  validatorId,
  index,
  onStake,
  onManage,
  userDelegation,
  userEarnedDelegatorShare,
}: ValidatorCardProps) {
  const { address, isConnected } = useAccount();
  const { hasCat } = useCatStatus(address);

  const { data: validator } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "getValidator",
    args: [BigInt(validatorId)],
  });

  const { data: meta } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "getValidatorMeta",
    args: [BigInt(validatorId)],
  });

  const { data: saturation } = useReadContract({
    address: ADDRESSES.STAKING,
    abi: STAKING_ABI,
    functionName: "getSaturationForValidator",
    args: [BigInt(validatorId)],
  });

  if (!validator || !validator.active) return null;

  const { operator, commissionBps, selfStake, totalStake } = validator;
  const delegated = totalStake - selfStake;
  const [delegatedSaturation, cap] = saturation ?? [0n, 0n];
  const capPct = cap > 0n ? Number((delegatedSaturation * 10000n) / cap) / 100 : 0;

  const displayName = meta?.name || `Validator #${validatorId}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="glass-card shine-line p-5 flex flex-col gap-4"
    >
      <div className="flex items-start gap-3">
        <ValidatorAvatar
          address={operator}
          avatarUrl={meta?.avatarUrl || undefined}
          size={44}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-sm font-semibold truncate block">{displayName}</span>
              <p className="mono text-xs text-[var(--text-muted)] mt-0.5">
                {shortenAddress(operator)}
              </p>
              {meta?.description && (
                <p className="text-[11px] text-[var(--text-secondary)] mt-1 italic line-clamp-1">
                  {meta.description}
                </p>
              )}
            </div>
            <div className="text-right shrink-0 flex flex-col gap-1">
              <div>
                <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  Self-stake
                </span>
                <p className="mono text-sm text-[var(--text-secondary)]">
                  {formatToken(selfStake)}
                </p>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  Delegated
                </span>
                <p className="mono text-sm text-[var(--text-secondary)]">
                  {formatToken(delegated)}
                </p>
                {cap > 0n && (
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Saturation {capPct.toFixed(1)}%
                  </p>
                )}
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  Commission
                </span>
                <p className="text-sm text-[var(--text-secondary)]">
                  <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5">
                    {commissionBpsToPercent(Number(commissionBps))}%
                  </span>
                </p>
              </div>
            </div>
          </div>
          {(meta?.website || meta?.twitter || meta?.github || meta?.chat || meta?.email) && (
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {meta.chat && (
                <span className="text-[10px] text-[var(--text-muted)]" title="Find on Redbelly Discord">
                  Discord: {meta.chat}
                </span>
              )}
              {meta.email && (
                <a
                  href={`https://t.me/${meta.email.replace(/^@/, "")}`}
                  target="_blank" rel="noopener noreferrer" className="text-[10px] text-[var(--accent)] hover:underline"
                  title="Open Telegram"
                >
                  Telegram
                </a>
              )}
              {meta.twitter && (
                <a
                  href={meta.twitter.startsWith("http") ? meta.twitter : `https://x.com/${meta.twitter.replace(/^@/, "")}`}
                  target="_blank" rel="noopener noreferrer" className="text-[10px] text-[var(--accent)] hover:underline"
                >
                  X/Twitter
                </a>
              )}
              {meta.github && (
                <a
                  href={meta.github.startsWith("http") ? meta.github : `https://github.com/${meta.github}`}
                  target="_blank" rel="noopener noreferrer" className="text-[10px] text-[var(--accent)] hover:underline"
                >
                  GitHub
                </a>
              )}
              {meta.website && (
                <a href={meta.website.startsWith("http") ? meta.website : `https://${meta.website}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[var(--accent)] hover:underline">
                  Website
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {(userDelegation > 0n || userEarnedDelegatorShare > 0n) && (
        <div className="grid grid-cols-2 gap-2 py-2 border-t border-[var(--border-subtle)]">
          {userDelegation > 0n && (
            <div>
              <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                Your stake
              </span>
              <p className="mono text-sm text-[var(--text-primary)]">
                {formatToken(userDelegation)}
              </p>
            </div>
          )}
          {userEarnedDelegatorShare > 0n && (
            <div>
              <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                Pending rewards
              </span>
              <p className="mono text-sm text-[var(--text-primary)]">
                {formatToken(userEarnedDelegatorShare)}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-auto">
        <button
          type="button"
          className={`flex-1 ${isConnected && hasCat ? "btn-primary" : "btn-primary opacity-50 cursor-not-allowed"}`}
          onClick={isConnected && hasCat ? onStake : undefined}
          disabled={!isConnected || !hasCat}
          title={!isConnected ? "Connect wallet to stake" : !hasCat ? "CAT verification required to stake" : undefined}
        >
          {!isConnected ? "Connect wallet" : !hasCat ? "CAT required" : "Stake"}
        </button>
        {isConnected && userDelegation > 0n && (
          <button
            type="button"
            className="btn-ghost flex-1"
            onClick={onManage}
          >
            Manage
          </button>
        )}
      </div>
    </motion.div>
  );
}

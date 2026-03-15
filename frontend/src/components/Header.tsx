"use client";

import { useState, useEffect } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { motion } from "framer-motion";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { ADDRESSES, ERC20_ABI, MOCK_ERC20_MINT_ABI } from "@/lib/contracts";
import { formatToken } from "@/lib/utils";
import { useCatStatus } from "@/hooks/useCatStatus";
import { useTxRateLimit } from "@/hooks/useTxRateLimit";
import NetworkStats from "./NetworkStats";

const FAUCET_LIMIT = parseUnits("50000", 18);

function FaucetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v6" />
      <path d="M6 8h12" />
      <path d="M6 8c-1.1 0-2 .9-2 2v1c0 .6.4 1 1 1h1" />
      <path d="M18 8c1.1 0 2 .9 2 2v1c0 .6-.4 1-1 1h-1" />
      <path d="M10 12h4" />
      <path d="M12 12v4" />
      <path d="M8 20c0-2.2 1.8-4 4-4s4 1.8 4 4" />
      <path d="M7 20h10" />
    </svg>
  );
}

export default function Header() {
  const { address, isConnected } = useAccount();
  const { hasCat, isLoading: catLoading } = useCatStatus(address);
  const [minting, setMinting] = useState(false);
  const { canSend: canSendFaucet, recordSend: recordFaucet, cooldownRemaining: faucetCooldown } = useTxRateLimit("faucet");

  const { data: stakingBalance, refetch: refetchBalance } = useReadContract({
    address: ADDRESSES.STAKING_TOKEN,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && ADDRESSES.STAKING_TOKEN !== "0x0000000000000000000000000000000000000000" },
  });

  const { data: rewardBalance } = useReadContract({
    address: ADDRESSES.REWARD_TOKEN,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && ADDRESSES.REWARD_TOKEN !== "0x0000000000000000000000000000000000000000" },
  });

  const { writeContract: mint, data: mintTx } = useWriteContract();
  const { isSuccess: mintConfirmed } = useWaitForTransactionReceipt({ hash: mintTx });

  const balance = (stakingBalance as bigint) ?? 0n;
  const canMint = isConnected && hasCat && balance < FAUCET_LIMIT;
  const mintAmount = FAUCET_LIMIT > balance ? FAUCET_LIMIT - balance : 0n;

  useEffect(() => {
    if (mintConfirmed && minting) {
      setMinting(false);
      refetchBalance();
    }
  }, [mintConfirmed, minting, refetchBalance]);

  const handleFaucet = () => {
    if (!address || !canMint || mintAmount === 0n || !canSendFaucet) return;
    setMinting(true);
    recordFaucet();
    mint({
      address: ADDRESSES.STAKING_TOKEN,
      abi: MOCK_ERC20_MINT_ABI,
      functionName: "mint",
      args: [address, mintAmount],
    });
  };

  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="sticky top-0 z-50 flex items-center justify-between px-6 py-5 lg:px-10 backdrop-blur-xl"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-lg font-semibold tracking-tight">
              Redbelly Shared Node Staking
            </span>
            <span className="text-xs text-[var(--text-muted)] tracking-wide uppercase">
              Template Demo Interface
            </span>
          </div>
          <div className="ml-2 flex items-center gap-1.5">
            <div className="live-dot" />
            <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Testnet
            </span>
          </div>
        </div>
        <NetworkStats />
      </div>

      <div className="flex items-center gap-4">
        {isConnected && (
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="hidden md:flex items-center gap-4 text-xs"
          >
            <div className="flex flex-col items-end">
              <span className="text-[var(--text-muted)] uppercase tracking-wider text-[10px]">
                Wallet (stake)
              </span>
              <span className="mono text-sm text-[var(--text-secondary)]">
                {formatToken(balance)}
              </span>
            </div>
            {ADDRESSES.STAKING_TOKEN !== ADDRESSES.REWARD_TOKEN && rewardBalance !== undefined && (
              <>
                <div className="w-px h-6 bg-[var(--border-subtle)]" />
                <div className="flex flex-col items-end">
                  <span className="text-[var(--text-muted)] uppercase tracking-wider text-[10px]">
                    Rewards
                  </span>
                  <span className="mono text-sm text-[var(--text-secondary)]">
                    {formatToken((rewardBalance as bigint) ?? 0n)}
                  </span>
                </div>
              </>
            )}
            <div className="w-px h-6 bg-[var(--border-subtle)]" />
            {!catLoading && (
              <span
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest font-medium border ${
                  hasCat
                    ? "border-green-500/30 text-green-500 bg-green-500/5"
                    : "border-red-400/30 text-red-400 bg-red-400/5"
                }`}
                title={hasCat ? `CAT verified: ${address}` : `Not CAT verified: ${address}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${hasCat ? "bg-green-500" : "bg-red-400"}`} />
                CAT {hasCat ? "✓" : "✕"}
              </span>
            )}
            <div className="w-px h-6 bg-[var(--border-subtle)]" />
            <button
              type="button"
              onClick={handleFaucet}
              disabled={!canMint || minting || !canSendFaucet}
              title={
                !hasCat
                  ? "CAT verification required"
                  : !canSendFaucet
                    ? `Rate limit: wait ${faucetCooldown}s`
                    : canMint
                      ? `Get ${formatToken(mintAmount)} test STK`
                      : "Faucet limit reached (50K STK)"
              }
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all ${
                canMint && !minting && canSendFaucet
                  ? "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-card)]"
                  : "border-transparent text-[var(--text-muted)] opacity-50 cursor-not-allowed"
              }`}
            >
              {minting ? (
                <div className="w-4 h-4 border-2 border-[var(--border-bright)] border-t-transparent rounded-full animate-spin" />
              ) : (
                <FaucetIcon />
              )}
              <span className="text-[10px] uppercase tracking-widest">
                {minting ? "Minting..." : !canSendFaucet && faucetCooldown > 0 ? `${faucetCooldown}s` : "Faucet"}
              </span>
            </button>
          </motion.div>
        )}
        <ConnectButton
          showBalance={false}
          chainStatus="icon"
          accountStatus="address"
        />
      </div>
    </motion.header>
  );
}

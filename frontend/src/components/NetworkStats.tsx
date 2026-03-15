"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePublicClient } from "wagmi";
import { formatGwei } from "viem";
import { CHAIN_ID } from "@/lib/contracts";

const CHAIN_POLL = 120_000;
const PRICE_POLL = 600_000;
const BLOCK_SAMPLE = 5;

interface ChainStats {
  blockNumber: bigint;
  gasPriceNrbnt: string;
  avgBlockTime: number | null;
  tps: number | null;
}

interface PriceData {
  usd: number;
  change24h: number;
}

export default function NetworkStats() {
  const client = usePublicClient();
  const [chain, setChain] = useState<ChainStats | null>(null);
  const [price, setPrice] = useState<PriceData | null>(null);
  const mountedRef = useRef(true);

  const fetchChain = useCallback(async () => {
    if (!client) return;
    try {
      const [bn, gp] = await Promise.all([
        client.getBlockNumber(),
        client.getGasPrice(),
      ]);

      const gasNum = parseFloat(formatGwei(gp));
      const gasPriceNrbnt = gasNum.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      let avgBlockTime: number | null = null;
      let tps: number | null = null;

      if (bn > BigInt(BLOCK_SAMPLE)) {
        const blockNumbers = Array.from(
          { length: BLOCK_SAMPLE + 1 },
          (_, i) => bn - BigInt(i),
        );
        const blocks = await Promise.all(
          blockNumbers.map((n) => client.getBlock({ blockNumber: n })),
        );
        const timeDiff = Number(
          blocks[0].timestamp - blocks[BLOCK_SAMPLE].timestamp,
        );
        if (timeDiff > 0) {
          avgBlockTime = timeDiff / BLOCK_SAMPLE;
          const totalTxs = blocks
            .slice(0, BLOCK_SAMPLE)
            .reduce((sum, b) => sum + b.transactions.length, 0);
          tps = totalTxs / timeDiff;
        }
      }

      if (mountedRef.current) {
        setChain({ blockNumber: bn, gasPriceNrbnt, avgBlockTime, tps });
      }
    } catch (e) {
      console.error("NetworkStats chain:", e);
    }
  }, [client]);

  const fetchPrice = useCallback(async () => {
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=redbelly-network-token&vs_currencies=usd&include_24hr_change=true",
      );
      if (!res.ok) return;
      const data = await res.json();
      const token = data["redbelly-network-token"];
      if (token && mountedRef.current) {
        setPrice({
          usd: token.usd,
          change24h: token.usd_24h_change ?? 0,
        });
      }
    } catch (e) {
      console.error("NetworkStats price:", e);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchChain();
    fetchPrice();
    const chainId = setInterval(fetchChain, CHAIN_POLL);
    const priceId = setInterval(fetchPrice, PRICE_POLL);
    return () => {
      mountedRef.current = false;
      clearInterval(chainId);
      clearInterval(priceId);
    };
  }, [fetchChain, fetchPrice]);

  if (!chain) return null;

  const changeColor =
    price && price.change24h >= 0
      ? "text-green-500"
      : "text-red-400";

  const changeSign = price && price.change24h >= 0 ? "+" : "";

  const items: { label: string; value: string; extra?: string; extraClass?: string }[] = [
    ...(price
      ? [
          {
            label: "RBNT",
            value: `$${price.usd.toFixed(6)}`,
            extra: `(${changeSign}${price.change24h.toFixed(2)}%)`,
            extraClass: changeColor,
          },
        ]
      : []),
    { label: "Chain", value: String(CHAIN_ID) },
    { label: "Block", value: Number(chain.blockNumber).toLocaleString() },
    { label: "Gas", value: `${chain.gasPriceNrbnt} nRBNT` },
    ...(chain.tps !== null
      ? [{ label: "TPS", value: chain.tps.toFixed(3) }]
      : []),
    ...(chain.avgBlockTime !== null
      ? [{ label: "Avg block", value: `${chain.avgBlockTime.toFixed(1)}s` }]
      : []),
  ];

  return (
    <div className="hidden lg:flex items-center gap-2 text-[10px] text-[var(--text-muted)] flex-wrap">
      {items.map((item, i) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {i > 0 && (
            <span className="text-[var(--border-bright)] select-none">·</span>
          )}
          <span className="uppercase tracking-widest">{item.label}</span>
          <span className="mono text-[var(--text-secondary)]">
            {item.value}
          </span>
          {item.extra && (
            <span className={`mono ${item.extraClass ?? ""}`}>
              {item.extra}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

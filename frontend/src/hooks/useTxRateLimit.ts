"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "stk-v3-tx-rate";
const COOLDOWN_MS = 20_000;

type TxAction =
  | "faucet"
  | "stake"
  | "unstake"
  | "withdraw"
  | "claim"
  | "register"
  | "redelegate"
  | "approve";

function getStored(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Record<string, number>;
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

function setStored(updates: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    const prev = getStored();
    const next = { ...prev, ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function useTxRateLimit(action: TxAction) {
  const [lastSentAt, setLastSentAt] = useState<number | null>(() => {
    const stored = getStored()[action] ?? null;
    return stored && typeof stored === "number" ? stored : null;
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || e.newValue == null) return;
      try {
        const data = JSON.parse(e.newValue) as Record<string, number>;
        const v = data[action];
        if (typeof v === "number") setLastSentAt(v);
      } catch {
        // ignore
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [action]);

  const now = Date.now();
  const canSend = lastSentAt === null || now - lastSentAt >= COOLDOWN_MS;
  const cooldownRemaining = lastSentAt === null ? 0 : Math.max(0, Math.ceil((lastSentAt + COOLDOWN_MS - now) / 1000));

  const recordSend = useCallback(() => {
    const t = Date.now();
    setStored({ [action]: t });
    setLastSentAt(t);
  }, [action]);

  return { canSend, recordSend, cooldownRemaining };
}

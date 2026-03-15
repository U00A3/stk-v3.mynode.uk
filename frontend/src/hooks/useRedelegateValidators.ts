"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { ADDRESSES, STAKING_ABI } from "@/lib/contracts";
import { formatToken } from "@/lib/utils";
import type { Validator } from "@/components/ValidatorSelect";

export type ValidatorWithId = Validator & { id: number };

export function useRedelegateValidators(otherValidatorIds: number[]): ValidatorWithId[] {
  const contracts = useMemo(
    () =>
      otherValidatorIds.flatMap((id) => [
        {
          address: ADDRESSES.STAKING,
          abi: STAKING_ABI,
          functionName: "getValidator" as const,
          args: [BigInt(id)] as const,
        },
        {
          address: ADDRESSES.STAKING,
          abi: STAKING_ABI,
          functionName: "getValidatorMeta" as const,
          args: [BigInt(id)] as const,
        },
      ]),
    [otherValidatorIds]
  );

  const { data } = useReadContracts({
    contracts,
    query: { enabled: otherValidatorIds.length > 0 },
  });

  return useMemo(() => {
    if (!data || data.length === 0) return [];
    const results: ValidatorWithId[] = [];
    for (let i = 0; i < otherValidatorIds.length; i++) {
      const id = otherValidatorIds[i];
      const rawVal = data[2 * i];
      const rawMeta = data[2 * i + 1];
      const validatorData = (rawVal && typeof rawVal === "object" && "result" in rawVal ? (rawVal as { result: unknown }).result : rawVal) as { operator?: string; commissionBps?: number; active?: boolean; totalStake?: bigint } | null;
      const metaData = (rawMeta && typeof rawMeta === "object" && "result" in rawMeta ? (rawMeta as { result: unknown }).result : rawMeta) as { name?: string } | null;
      const validator = validatorData && validatorData.operator != null ? validatorData : null;
      const meta = metaData ?? null;
      if (!validator?.operator) continue;
      const moniker = meta?.name?.trim() || `Validator #${id}`;
      const commission = `${(Number(validator.commissionBps ?? 0) / 100).toFixed(1)}%`;
      const status = validator.active !== false ? ("active" as const) : ("inactive" as const);
      const votingPower = formatToken(validator.totalStake ?? 0n);
      results.push({
        id,
        address: validator.operator,
        moniker,
        commission,
        status,
        votingPower,
      });
    }
    return results;
  }, [data, otherValidatorIds]);
}

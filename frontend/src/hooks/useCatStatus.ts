"use client";

import { useReadContract } from "wagmi";
import { type Address } from "viem";
import { BOOTSTRAP_ADDRESS, BOOTSTRAP_ABI, PERMISSION_ABI } from "@/lib/contracts";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export function useCatStatus(address: Address | undefined) {
  const { data: permissionAddr } = useReadContract({
    address: BOOTSTRAP_ADDRESS,
    abi: BOOTSTRAP_ABI,
    functionName: "getContractAddress",
    args: ["permission"],
  });

  const resolvedPermission =
    permissionAddr && permissionAddr !== ZERO ? permissionAddr : undefined;

  const { data: isAllowed, isLoading } = useReadContract({
    address: resolvedPermission,
    abi: PERMISSION_ABI,
    functionName: "isAllowed",
    args: address ? [address] : undefined,
    query: { enabled: !!resolvedPermission && !!address },
  });

  return {
    hasCat: isAllowed === true,
    isLoading: isLoading && !!address,
  };
}

import { type FundSnapshot, fundV2Abi } from "@tesoreria/agent";
import type { PublicClient } from "viem";
import { memberFundAbi } from "./fund-abi";

/**
 * A fund's whole balance in its currency, at the snapshot's block: what the inicio and the week's summary show. Version 1
 * reads `balanceInWars` (its wARS plus its USDT at the pool's TWAP); version 2 reads `balanceInCurrency` (what it can pay
 * plus every dollar it holds at the TWAP), since FundV2 has no `balanceInWars`. A version 2 fund with no dollar never
 * reads a pool for it.
 */
export function readBalance(client: Pick<PublicClient, "readContract">, snapshot: FundSnapshot): Promise<bigint> {
  const at = { address: snapshot.address, blockNumber: snapshot.block } as const;
  return snapshot.version === 2
    ? client.readContract({ ...at, abi: fundV2Abi, functionName: "balanceInCurrency" })
    : client.readContract({ ...at, abi: memberFundAbi, functionName: "balanceInWars" });
}

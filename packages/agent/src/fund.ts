import type { Address, PublicClient } from "viem";
import { erc20Abi } from "viem";
import { fundAbi, fundFactoryAbi } from "./abi";
import { USDT, WARS } from "./chain";

/** A fund's state, read from the chain at one block. */
export type FundSnapshot = {
  address: Address;
  /** The block every value was read at. */
  block: bigint;
  agent: Address;
  closed: boolean;
  /** The current members, as the contract lists them: the only addresses the agent ever pays. */
  members: readonly Address[];
  /** What each member has contributed, in wARS, in the order of `members`. */
  contributed: readonly bigint[];
  totalContributed: bigint;
  votesRequired: number;
  weeklyCap: bigint;
  startTime: bigint;
  week: bigint;
  spentThisWeek: bigint;
  warsBalance: bigint;
  usdtBalance: bigint;
};

/** The reads the agent needs from a Celo client. */
export type CeloReader = Pick<PublicClient, "getBlockNumber" | "multicall" | "readContract">;

/** Reads a fund's state, every value at the same block. */
export async function readFund(client: CeloReader, fund: Address): Promise<FundSnapshot> {
  const blockNumber = await client.getBlockNumber();
  const at = { allowFailure: false, blockNumber } as const;
  const [agent, closed, members, votesRequired, weeklyCap, startTime, week, totalContributed, warsBalance, usdtBalance] =
    await client.multicall({
      ...at,
      contracts: [
        { address: fund, abi: fundAbi, functionName: "agent" },
        { address: fund, abi: fundAbi, functionName: "closed" },
        { address: fund, abi: fundAbi, functionName: "members" },
        { address: fund, abi: fundAbi, functionName: "votesRequired" },
        { address: fund, abi: fundAbi, functionName: "weeklyCap" },
        { address: fund, abi: fundAbi, functionName: "startTime" },
        { address: fund, abi: fundAbi, functionName: "currentWeek" },
        { address: fund, abi: fundAbi, functionName: "totalContributed" },
        { address: WARS, abi: erc20Abi, functionName: "balanceOf", args: [fund] },
        { address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [fund] },
      ],
    });
  const [spentThisWeek, contributed] = await Promise.all([
    client.readContract({ address: fund, abi: fundAbi, functionName: "spentInWeek", args: [week], blockNumber }),
    client.multicall({
      ...at,
      contracts: members.map((member) => ({ address: fund, abi: fundAbi, functionName: "contributed", args: [member] }) as const),
    }),
  ]);
  return {
    address: fund,
    block: blockNumber,
    agent,
    closed,
    members,
    contributed,
    totalContributed,
    votesRequired,
    weeklyCap,
    startTime,
    week,
    spentThisWeek,
    warsBalance,
    usdtBalance,
  };
}

/** Every fund the factory has created, oldest first. */
export async function listFunds(client: CeloReader, factory: Address): Promise<Address[]> {
  const count = await client.readContract({ address: factory, abi: fundFactoryAbi, functionName: "fundCount" });
  if (count === 0n) return [];
  return client.multicall({
    allowFailure: false,
    contracts: Array.from({ length: Number(count) }, (_, i) => ({
      address: factory,
      abi: fundFactoryAbi,
      functionName: "funds",
      args: [BigInt(i)],
    }) as const),
  });
}

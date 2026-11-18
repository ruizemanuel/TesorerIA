import { type Address, type PublicClient, erc20Abi } from "viem";
import { FACTORIES, type Factory, USDT } from "./chain";
import { type LogReader, readFundEvents } from "./events";
import { type CeloReader, listFunds, readFund } from "./fund";
import { type ContractReader, quoteConversion, readReferences } from "./market";
import type { ChainView } from "./run";

/** What the agent needs from its Celo client. */
export type CeloClient = CeloReader & Pick<PublicClient, "simulateContract" | "waitForTransactionReceipt">;

/** The block of the oldest factory: no fund of any of them has an event before it. */
function oldestBlock(factories: readonly Factory[]): bigint {
  const [first, ...others] = factories;
  if (first === undefined) throw new Error("A chain view needs at least one factory");
  return others.reduce((oldest, { block }) => (block < oldest ? block : oldest), first.block);
}

/**
 * The real ChainView: Celo for the funds and the pool, Base or Celo for each currency's Chainlink feed, and `logs` for the funds'
 * histories (Blockscout plus the node on mainnet; the node alone on a fork). It serves the funds of every factory.
 */
export function createChainView({
  celo,
  base,
  logs,
  agent,
  factories = FACTORIES,
  fromBlock = oldestBlock(factories),
}: {
  celo: CeloClient;
  base: ContractReader;
  logs: LogReader;
  agent: Address;
  factories?: readonly Factory[];
  /** No fund has events before this block: by default, the oldest factory's. */
  fromBlock?: bigint;
}): ChainView {
  return {
    gasBalance: () => celo.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [agent] }),
    funds: () => listFunds(celo, factories),
    fund: (ref) => readFund(celo, ref),
    events: (fund, toBlock) => readFundEvents(logs, fund, fromBlock, toBlock),
    references: (currency) => readReferences({ base, celo }, currency),
    quote: (fund, dollarAmount) => quoteConversion(celo, fund, dollarAmount),
    receipt: async (hash) => (await celo.waitForTransactionReceipt({ hash })).status,
  };
}

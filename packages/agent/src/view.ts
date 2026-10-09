import { type Address, type PublicClient, erc20Abi } from "viem";
import { FUND_FACTORY, FUND_FACTORY_BLOCK, USDT } from "./chain";
import { type LogReader, readFundEvents } from "./events";
import { listFunds, readFund } from "./fund";
import { type ContractReader, quoteConversion, readReferences } from "./market";
import type { ChainView } from "./run";

/** What the agent needs from its Celo client. */
export type CeloClient = Pick<
  PublicClient,
  "getBlockNumber" | "multicall" | "readContract" | "simulateContract" | "waitForTransactionReceipt"
>;

/**
 * The real ChainView: Celo for the funds and the pool, Base for Chainlink's USD / ARS, and `logs` for the funds'
 * histories (Blockscout plus the node on mainnet; the node alone on a fork).
 */
export function createChainView({
  celo,
  base,
  logs,
  agent,
  factory = FUND_FACTORY,
  fromBlock = FUND_FACTORY_BLOCK,
}: {
  celo: CeloClient;
  base: ContractReader;
  logs: LogReader;
  agent: Address;
  factory?: Address;
  /** No fund has events before this block. */
  fromBlock?: bigint;
}): ChainView {
  return {
    gasBalance: () => celo.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [agent] }),
    funds: () => listFunds(celo, factory),
    fund: (address) => readFund(celo, address),
    events: (fund, toBlock) => readFundEvents(logs, fund, fromBlock, toBlock),
    references: () => readReferences({ base, celo }),
    quote: (fund, usdtAmount) => quoteConversion(celo, fund, usdtAmount),
    receipt: async (hash) => (await celo.waitForTransactionReceipt({ hash })).status,
  };
}

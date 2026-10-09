import { type Address, type DecodeEventLogReturnType, type Hash, type Hex, type PublicClient, decodeEventLog } from "viem";
import { fundAbi } from "./abi";

/** A log as the agent needs it: where it is, and what it says. */
export type RawLog = {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  transactionHash: Hash;
  logIndex: number;
};

/** Reads every log an address emitted between two blocks, both included. */
export type LogReader = (query: { address: Address; fromBlock: bigint; toBlock: bigint }) => Promise<RawLog[]>;

/** A fund's decoded event, with where it happened. */
export type FundEvent = DecodeEventLogReturnType<typeof fundAbi> & {
  blockNumber: bigint;
  transactionHash: Hash;
  logIndex: number;
};

/** Forno, like the other public Celo RPCs, answers eth_getLogs for at most 5,000 blocks at a time. */
export const RPC_LOG_RANGE = 5_000n;

/** Reads logs straight from a node, `range` blocks per request. */
export function rpcLogReader(client: Pick<PublicClient, "getLogs">, range: bigint = RPC_LOG_RANGE): LogReader {
  return async ({ address, fromBlock, toBlock }) => {
    const logs: RawLog[] = [];
    for (let from = fromBlock; from <= toBlock; from += range) {
      const to = from + range - 1n < toBlock ? from + range - 1n : toBlock;
      for (const log of await client.getLogs({ address, fromBlock: from, toBlock: to })) {
        if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) continue;
        const { blockNumber, transactionHash, logIndex, data, topics } = log;
        logs.push({ address: log.address, topics: [...topics], data, blockNumber, transactionHash, logIndex });
      }
    }
    return logs;
  };
}

type BlockscoutLog = {
  address: Address;
  topics: (Hex | null)[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hash;
  logIndex: Hex;
};

/** Blockscout's getLogs returns at most 1,000 logs, oldest first, and ignores `page` and `offset`. */
const BLOCKSCOUT_PAGE = 1_000;

/**
 * Reads a whole log history from Blockscout's API in a request or two, plus the last RPC_LOG_RANGE blocks
 * from the node, because the indexer can lag behind the chain. Any failure throws: the agent never decides
 * on a history it could not read in full.
 */
export function blockscoutLogReader({
  apiUrl,
  rpc,
  fetchFn = fetch,
}: {
  apiUrl: string;
  rpc: LogReader;
  fetchFn?: typeof fetch;
}): LogReader {
  return async ({ address, fromBlock, toBlock }) => {
    const byPosition = new Map<string, RawLog>();
    const add = (log: RawLog) => byPosition.set(`${log.transactionHash}:${log.logIndex}`, log);
    let from = fromBlock;
    for (;;) {
      const url = `${apiUrl}?module=logs&action=getLogs&address=${address}&fromBlock=${from}&toBlock=${toBlock}`;
      const response = await fetchFn(url);
      if (!response.ok) throw new Error(`Blockscout answered HTTP ${response.status}`);
      const body = (await response.json()) as { status: string; message: string; result: unknown };
      if (body.status !== "1") {
        if (body.message === "No logs found") break;
        throw new Error(`Blockscout answered: ${body.message}`);
      }
      const page = body.result as BlockscoutLog[];
      for (const log of page) {
        add({
          address: log.address,
          topics: log.topics.filter((topic): topic is Hex => topic !== null),
          data: log.data,
          blockNumber: BigInt(log.blockNumber),
          transactionHash: log.transactionHash,
          logIndex: Number(log.logIndex),
        });
      }
      const last = page.at(-1);
      if (page.length < BLOCKSCOUT_PAGE || last === undefined) break;
      // Ask again from the last block: the logs already read come back and dedupe.
      const lastBlock = BigInt(last.blockNumber);
      if (lastBlock === from) throw new Error(`More than ${BLOCKSCOUT_PAGE} logs in block ${lastBlock}`);
      from = lastBlock;
    }
    const tailFrom = toBlock - RPC_LOG_RANGE + 1n > fromBlock ? toBlock - RPC_LOG_RANGE + 1n : fromBlock;
    for (const log of await rpc({ address, fromBlock: tailFrom, toBlock })) add(log);
    return [...byPosition.values()];
  };
}

/** A fund's events between two blocks, decoded and in chain order. Logs it can't decode are left out. */
export async function readFundEvents(
  reader: LogReader,
  fund: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<FundEvent[]> {
  const events: FundEvent[] = [];
  for (const log of await reader({ address: fund, fromBlock, toBlock })) {
    if (log.address.toLowerCase() !== fund.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: fundAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      events.push({ ...decoded, blockNumber: log.blockNumber, transactionHash: log.transactionHash, logIndex: log.logIndex });
    } catch {
      // Not one of the fund's events.
    }
  }
  return events.sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
}

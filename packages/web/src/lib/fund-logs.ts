import { type LogReader, RPC_LOG_RANGE, type RawLog } from "@tesoreria/agent";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Address, Hash } from "viem";
import type { Db } from "./db/client";
import { fundLogRanges, fundLogs } from "./db/schema";

/**
 * The latest blocks of a read that are never kept, about five minutes of Celo's: they're read from the node every
 * time, so a reorg can't leave a log in the database that the chain dropped.
 */
export const UNKEPT_BLOCKS = 300n;

/** The node's requests made at once: 100,000 blocks, about a day of Celo's. */
const NODE_REQUESTS_AT_ONCE = 20;

/** Every log `address` emitted from `fromBlock` to `toBlock`, from the node, RPC_LOG_RANGE blocks per request. */
async function fromNode(node: LogReader, address: Address, fromBlock: bigint, toBlock: bigint): Promise<RawLog[]> {
  const ranges: [bigint, bigint][] = [];
  for (let from = fromBlock; from <= toBlock; from += RPC_LOG_RANGE) {
    ranges.push([from, from + RPC_LOG_RANGE - 1n < toBlock ? from + RPC_LOG_RANGE - 1n : toBlock]);
  }
  const logs: RawLog[] = [];
  for (let i = 0; i < ranges.length; i += NODE_REQUESTS_AT_ONCE) {
    const batch = ranges.slice(i, i + NODE_REQUESTS_AT_ONCE);
    logs.push(...(await Promise.all(batch.map(([from, to]) => node({ address, fromBlock: from, toBlock: to })))).flat());
  }
  return logs;
}

/**
 * A fund's history kept in the database (fund_logs): the node gives only the blocks it doesn't have yet, before or
 * after the ones it kept, and the latest UNKEPT_BLOCKS of every read. The first read of a fund comes whole from the
 * node, NODE_REQUESTS_AT_ONCE requests at a time. A node request that fails throws before anything is kept, so what
 * fund_log_ranges says is kept always is. Blockscout isn't needed: on 3/11 its logs fell a day behind, and on 4/11
 * its getLogs stopped answering. What a read gives is still checked against the contract (completeHistory).
 */
export function keptLogReader({ db, node }: { db: () => Promise<Db>; node: LogReader }): LogReader {
  return async ({ address, fromBlock, toBlock }) => {
    const fund = address.toLowerCase();
    const store = await db();
    const [kept] = await store.select().from(fundLogRanges).where(eq(fundLogRanges.fund, fund));
    const missing: [bigint, bigint][] = [];
    if (kept === undefined) missing.push([fromBlock, toBlock]);
    else {
      if (fromBlock < kept.fromBlock) missing.push([fromBlock, kept.fromBlock - 1n < toBlock ? kept.fromBlock - 1n : toBlock]);
      if (toBlock > kept.toBlock) missing.push([kept.toBlock + 1n > fromBlock ? kept.toBlock + 1n : fromBlock, toBlock]);
    }
    const read = (await Promise.all(missing.map(([from, to]) => fromNode(node, address, from, to)))).flat();

    // Keep what's older than this read's latest UNKEPT_BLOCKS, and say which blocks are kept: all of them were read.
    const keepTo = toBlock - UNKEPT_BLOCKS;
    const keep = read.filter((log) => log.blockNumber <= keepTo);
    for (let i = 0; i < keep.length; i += 500) {
      await store
        .insert(fundLogs)
        .values(
          keep.slice(i, i + 500).map((log) => ({
            fund,
            block: log.blockNumber,
            transactionHash: log.transactionHash,
            logIndex: log.logIndex,
            topics: log.topics,
            data: log.data,
          })),
        )
        .onConflictDoNothing();
    }
    const from = kept === undefined || fromBlock < kept.fromBlock ? fromBlock : kept.fromBlock;
    // Two reads at once can both keep blocks: each one's are contiguous with what was kept and reach near the head,
    // so the union of the two is too.
    const to = kept === undefined || keepTo > kept.toBlock ? keepTo : kept.toBlock;
    if (to >= from) {
      await store
        .insert(fundLogRanges)
        .values({ fund, fromBlock: from, toBlock: to })
        .onConflictDoUpdate({
          target: fundLogRanges.fund,
          set: { fromBlock: sql`least(${fundLogRanges.fromBlock}, excluded.from_block)`, toBlock: sql`greatest(${fundLogRanges.toBlock}, excluded.to_block)` },
        });
    }

    // What's kept from fromBlock to toBlock, and what the node just gave that isn't kept: one copy of each log.
    const rows = await store
      .select()
      .from(fundLogs)
      .where(and(eq(fundLogs.fund, fund), gte(fundLogs.block, fromBlock), lte(fundLogs.block, toBlock)))
      .orderBy(fundLogs.block, fundLogs.logIndex);
    const logs = new Map<string, RawLog>();
    for (const row of rows) {
      logs.set(`${row.transactionHash}:${row.logIndex}`, {
        address,
        topics: row.topics,
        data: row.data as `0x${string}`,
        blockNumber: row.block,
        transactionHash: row.transactionHash as Hash,
        logIndex: row.logIndex,
      });
    }
    for (const log of read) if (log.blockNumber > keepTo) logs.set(`${log.transactionHash}:${log.logIndex}`, log);
    return [...logs.values()];
  };
}

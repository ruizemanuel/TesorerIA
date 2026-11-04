import { type LogReader, RPC_LOG_RANGE, type RawLog } from "@tesoreria/agent";
import { type Address, type Hash, getAddress, pad, toHex } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/lib/db/client";
import { UNKEPT_BLOCKS, keptLogReader } from "../src/lib/fund-logs";
import { testDb } from "./support/db";

const FUND = getAddress("0x00000000000000000000000000000000000f00d1");
const OTHER = getAddress("0x00000000000000000000000000000000000f00d2");
/** The fund was created at FROM, and HEAD is the chain's latest block: 50,001 blocks, 11 of the node's requests. */
const FROM = 1_000_000n;
const HEAD = FROM + 50_000n;

/** A log of `fund` at `block`, in a transaction of its own. */
const logAt = (block: bigint, fund: Address = FUND): RawLog => ({
  address: fund,
  topics: [pad("0x01", { size: 32 })],
  data: toHex(block, { size: 32 }),
  blockNumber: block,
  transactionHash: pad(toHex(block), { size: 32 }) as Hash,
  logIndex: 0,
});

/** A node that answers any range of `chain`'s logs, at most RPC_LOG_RANGE blocks at a time, and keeps what it was asked. */
function nodeOf(chain: RawLog[]) {
  const asked: [bigint, bigint][] = [];
  const node: LogReader = async ({ address, fromBlock, toBlock }) => {
    if (toBlock - fromBlock + 1n > RPC_LOG_RANGE) throw new Error(`Asked for ${toBlock - fromBlock + 1n} blocks`);
    asked.push([fromBlock, toBlock]);
    return chain.filter((log) => log.address === address && log.blockNumber >= fromBlock && log.blockNumber <= toBlock);
  };
  return { node, asked };
}

const byBlock = (logs: RawLog[]) => [...logs].sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));
const oldest = (asked: [bigint, bigint][]) => asked.reduce((min, [from]) => (from < min ? from : min), HEAD + 1n);

let db: Db;
beforeEach(async () => {
  db = await testDb();
});

describe("keptLogReader: a fund's history kept in the database, so only new blocks come from the node", () => {
  it("reads a fund's history from the node once, and afterwards only the blocks it hasn't kept", async () => {
    const chain = [logAt(FROM + 10n), logAt(FROM + 20_000n), logAt(HEAD - 10n)];
    const { node, asked } = nodeOf(chain);
    const read = keptLogReader({ db: async () => db, node });

    expect(byBlock(await read({ address: FUND, fromBlock: FROM, toBlock: HEAD }))).toEqual(chain);
    expect(oldest(asked)).toBe(FROM);

    asked.length = 0;
    expect(byBlock(await read({ address: FUND, fromBlock: FROM, toBlock: HEAD }))).toEqual(chain);
    // Only the latest UNKEPT_BLOCKS, which it never keeps, in one request.
    expect(asked).toEqual([[HEAD - UNKEPT_BLOCKS + 1n, HEAD]]);
  });

  it("never keeps the latest blocks, so a log the chain drops from them is gone on the next read", async () => {
    const chain = [logAt(FROM + 10n), logAt(HEAD - 10n)];
    const { node } = nodeOf(chain);
    const read = keptLogReader({ db: async () => db, node });
    await read({ address: FUND, fromBlock: FROM, toBlock: HEAD });

    chain.pop();
    expect(await read({ address: FUND, fromBlock: FROM, toBlock: HEAD })).toEqual([logAt(FROM + 10n)]);
  });

  it("reads up to an earlier block from what it kept, without asking the node", async () => {
    const chain = [logAt(FROM + 10n), logAt(FROM + 20_000n), logAt(FROM + 40_000n)];
    const { node, asked } = nodeOf(chain);
    const read = keptLogReader({ db: async () => db, node });
    await read({ address: FUND, fromBlock: FROM, toBlock: HEAD });

    asked.length = 0;
    expect(byBlock(await read({ address: FUND, fromBlock: FROM, toBlock: FROM + 30_000n }))).toEqual(chain.slice(0, 2));
    expect(asked).toEqual([]);
  });

  it("asks the node only for what it lacks before what it kept, when asked from an earlier block", async () => {
    const chain = [logAt(FROM + 10n), logAt(FROM + 20_000n)];
    const { node, asked } = nodeOf(chain);
    const read = keptLogReader({ db: async () => db, node });
    await read({ address: FUND, fromBlock: FROM + 15_000n, toBlock: HEAD });

    asked.length = 0;
    expect(byBlock(await read({ address: FUND, fromBlock: FROM, toBlock: HEAD }))).toEqual(chain);
    expect(oldest(asked)).toBe(FROM);
    expect(asked.every(([from, to]) => to < FROM + 15_000n || from > HEAD - UNKEPT_BLOCKS)).toBe(true);
  });

  it("keeps each fund's history apart", async () => {
    const { node } = nodeOf([logAt(FROM + 10n), logAt(FROM + 11n, OTHER)]);
    const read = keptLogReader({ db: async () => db, node });
    await read({ address: OTHER, fromBlock: FROM, toBlock: HEAD });
    expect(await read({ address: FUND, fromBlock: FROM, toBlock: HEAD })).toEqual([logAt(FROM + 10n)]);
    expect(await read({ address: OTHER, fromBlock: FROM, toBlock: HEAD })).toEqual([logAt(FROM + 11n, OTHER)]);
  });
});

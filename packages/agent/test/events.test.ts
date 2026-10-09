import { type Address, type Hash, type Hex, encodeAbiParameters, encodeEventTopics, pad, parseAbiParameters, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { fundAbi } from "../src/abi";
import { type LogReader, type RawLog, blockscoutLogReader, readFundEvents, rpcLogReader } from "../src/events";
import { FUND, MEMBERS, ref } from "./support/fixtures";

const MEMBER = MEMBERS[0] as Address;
const REF = ref(1);

function txHash(n: number): Hash {
  return pad(toHex(n), { size: 32 });
}

/** A Reimbursement log of FUND at block `block`, log index `index`. */
function reimbursementLog(block: bigint, index = 0, amount = 1n): RawLog {
  return {
    address: FUND,
    topics: encodeEventTopics({ abi: fundAbi, eventName: "Reimbursement", args: { member: MEMBER } }) as Hex[],
    data: encodeAbiParameters(parseAbiParameters("uint256, bytes32, uint256"), [amount, REF, 0n]),
    blockNumber: block,
    transactionHash: txHash(Number(block) * 1000 + index),
    logIndex: index,
  };
}

/** The same log the way Blockscout's API returns it: hex numbers, and the missing topics as null. */
function asBlockscout(log: RawLog) {
  return {
    ...log,
    topics: [...log.topics, ...Array<null>(4 - log.topics.length).fill(null)],
    blockNumber: toHex(log.blockNumber),
    logIndex: toHex(log.logIndex),
    timeStamp: "0x6ac879c8",
  };
}

/** A fetch that answers each request with the next body, and keeps the URLs. */
function fakeFetch(bodies: (object | { httpStatus: number })[]) {
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    const body = bodies.shift();
    if (body === undefined) throw new Error("unexpected request");
    if ("httpStatus" in body) return new Response("", { status: body.httpStatus });
    return Response.json(body);
  }) as typeof fetch;
  return { fetchFn, urls };
}

describe("rpcLogReader", () => {
  it("reads in 5,000-block ranges, the last one cut at toBlock", async () => {
    const ranges: [bigint, bigint][] = [];
    const client = {
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([fromBlock, toBlock]);
        return [];
      },
    };
    await rpcLogReader(client as never)({ address: FUND, fromBlock: 100n, toBlock: 12_000n });
    expect(ranges).toEqual([
      [100n, 5_099n],
      [5_100n, 10_099n],
      [10_100n, 12_000n],
    ]);
  });
});

describe("blockscoutLogReader", () => {
  const noTail: LogReader = async () => [];

  it("reads the history from Blockscout and the last 5,000 blocks from the node", async () => {
    const old = reimbursementLog(1_000n);
    const recent = reimbursementLog(19_000n);
    const { fetchFn, urls } = fakeFetch([{ status: "1", message: "OK", result: [asBlockscout(old), asBlockscout(recent)] }]);
    const tails: [bigint, bigint][] = [];
    const rpc: LogReader = async ({ fromBlock, toBlock }) => {
      tails.push([fromBlock, toBlock]);
      return [recent, reimbursementLog(19_999n)];
    };
    const logs = await blockscoutLogReader({ apiUrl: "https://example.org/api", rpc, fetchFn })({
      address: FUND,
      fromBlock: 0n,
      toBlock: 20_000n,
    });
    expect(urls).toEqual([
      `https://example.org/api?module=logs&action=getLogs&address=${FUND}&fromBlock=0&toBlock=20000`,
    ]);
    expect(tails).toEqual([[15_001n, 20_000n]]);
    expect(logs).toEqual([old, recent, reimbursementLog(19_999n)]);
  });

  it("asks again from the last block when a page comes back full, and drops the repeated logs", async () => {
    const first = Array.from({ length: 1_000 }, (_, i) => reimbursementLog(10n + BigInt(Math.floor(i / 2)), i % 2));
    const second = [reimbursementLog(509n, 1), reimbursementLog(600n)];
    const { fetchFn, urls } = fakeFetch([
      { status: "1", message: "OK", result: first.map(asBlockscout) },
      { status: "1", message: "OK", result: second.map(asBlockscout) },
    ]);
    const logs = await blockscoutLogReader({ apiUrl: "https://example.org/api", rpc: noTail, fetchFn })({
      address: FUND,
      fromBlock: 10n,
      toBlock: 700n,
    });
    expect(urls[1]).toContain("fromBlock=509&toBlock=700");
    expect(logs).toHaveLength(1_001);
  });

  it("takes 'No logs found' as an empty history", async () => {
    const { fetchFn } = fakeFetch([{ status: "0", message: "No logs found", result: [] }]);
    const logs = await blockscoutLogReader({ apiUrl: "https://example.org/api", rpc: noTail, fetchFn })({
      address: FUND,
      fromBlock: 0n,
      toBlock: 10n,
    });
    expect(logs).toEqual([]);
  });

  it("throws on any other answer, so no decision rests on a partial history", async () => {
    for (const body of [{ status: "0", message: "Max rate limit reached", result: null }, { httpStatus: 429 }]) {
      const { fetchFn } = fakeFetch([body]);
      const read = blockscoutLogReader({ apiUrl: "https://example.org/api", rpc: noTail, fetchFn });
      await expect(read({ address: FUND, fromBlock: 0n, toBlock: 10n })).rejects.toThrow("Blockscout answered");
    }
  });
});

describe("readFundEvents", () => {
  it("decodes the fund's events in chain order and leaves out what it can't decode", async () => {
    const later = reimbursementLog(7n, 0, 5n);
    const earlier = reimbursementLog(3n, 2, 4n);
    const foreign: RawLog = { ...reimbursementLog(5n), topics: [pad("0xdead", { size: 32 })] };
    const reader: LogReader = async () => [later, foreign, earlier];
    const events = await readFundEvents(reader, FUND, 0n, 10n);
    expect(events.map((e) => [e.eventName, e.blockNumber])).toEqual([
      ["Reimbursement", 3n],
      ["Reimbursement", 7n],
    ]);
    expect(events[0]).toMatchObject({ args: { member: MEMBER, amount: 4n, ref: REF, week: 0n } });
  });
});

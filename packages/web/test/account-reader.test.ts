import { USDT, WARS } from "@tesoreria/agent";
import { type Address, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { type BalanceClient, type Balances, accountReader } from "../src/lib/account-reader";

const ACCOUNT = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");

/**
 * A node with `wars` and `usdt` in the account, at block `head`. A read takes the balances when it starts; with
 * `hold()`, it waits to answer until `release()`, like one in flight while a pass lands. `fail` makes reads throw.
 */
function node(start: { wars: bigint; usdt: bigint; head: bigint }) {
  const state = { ...start, fail: false };
  let holding = false;
  const held: (() => void)[] = [];
  const client = {
    getBlockNumber: async () => state.head,
    readContract: async ({ address }: { address: Address }) => {
      const value = address === WARS ? state.wars : address === USDT ? state.usdt : 0n;
      const fail = state.fail;
      if (holding) await new Promise<void>((resolve) => held.push(resolve));
      if (fail) throw new Error("Forno is down");
      return value;
    },
  } as unknown as BalanceClient;
  return {
    state,
    client,
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;
      for (const answer of held.splice(0)) answer();
    },
  };
}

function reads(client: BalanceClient) {
  const seen: (Balances | null)[] = [];
  return { seen, reader: accountReader(client, ACCOUNT, (read) => seen.push(read)) };
}

/** A wait the test opens when it wants: a `sleep` for accountReader.changed that returns once `open()` is called. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, sleep: () => opened };
}

describe("accountReader: what a member's own account holds (spec, 9.2)", () => {
  it("hands each read over, and null when one fails, so whoever shows it keeps the last", async () => {
    const { state, client } = node({ wars: 5_000n, usdt: 3n, head: 10n });
    const { seen, reader } = reads(client);
    await reader.look();
    state.fail = true;
    await reader.look();
    expect(seen).toEqual([{ wars: 5_000n, usdt: 3n }, null]);
  });

  it("drops a read begun before a pass landed, so the old balance doesn't come back after it", async () => {
    const { state, client, hold, release } = node({ wars: 5_000n, usdt: 0n, head: 10n });
    const { seen, reader } = reads(client);
    hold();
    const inFlight = reader.look(); // takes 5.000, and answers late
    state.wars = 3_000n; // the pass lands in block 11, which the node has
    state.head = 11n;
    const after = reader.changed(11n);
    release();
    await Promise.all([inFlight, after]);
    expect(seen).toEqual([{ wars: 3_000n, usdt: 0n }]);
  });

  it("after a pass, waits for the node to have its block, and skips the routine looks meanwhile", async () => {
    const { state, client } = node({ wars: 5_000n, usdt: 0n, head: 10n });
    const { seen, reader } = reads(client);
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      if (sleeps.length === 2) Object.assign(state, { head: 12n, wars: 3_000n }); // the node catches up
    };
    const after = reader.changed(12n, sleep);
    await reader.look(); // while it waits: no read
    await after;
    expect(sleeps).toEqual([1_000, 1_000]);
    expect(seen).toEqual([{ wars: 3_000n, usdt: 0n }]);
  });

  it("lets the newest of two overlapping changes take over: the older one reads nothing and doesn't bring the looks back", async () => {
    const { state, client } = node({ wars: 5_000n, usdt: 0n, head: 10n });
    const { seen, reader } = reads(client);
    const olderWait = gate();
    const newerWait = gate();
    const older = reader.changed(12n, olderWait.sleep);
    const newer = reader.changed(13n, newerWait.sleep);
    Object.assign(state, { head: 12n, wars: 3_000n }); // the node reaches the older change's block, not the newer's
    olderWait.open();
    await older;
    await reader.look(); // the newer change is still awaited: no routine look, so nothing is read
    expect(seen).toEqual([]);
    Object.assign(state, { head: 13n, wars: 2_000n });
    newerWait.open();
    await newer;
    expect(seen).toEqual([{ wars: 2_000n, usdt: 0n }]);
  });

  it("reads anyway when the receipt had no block, or the node is too far behind to wait for", async () => {
    const { client } = node({ wars: 5_000n, usdt: 0n, head: 10n });
    const { seen, reader } = reads(client);
    await reader.changed(undefined);
    await reader.changed(500n); // more than MAX_BLOCKS_AHEAD past the node
    expect(seen).toEqual([
      { wars: 5_000n, usdt: 0n },
      { wars: 5_000n, usdt: 0n },
    ]);
  });

  it("goes back to its routine looks once a change was read", async () => {
    const { state, client } = node({ wars: 5_000n, usdt: 0n, head: 10n });
    const { seen, reader } = reads(client);
    await reader.changed(10n);
    state.wars = 7_000n; // a reimbursement arrives later
    await reader.look();
    expect(seen).toEqual([
      { wars: 5_000n, usdt: 0n },
      { wars: 7_000n, usdt: 0n },
    ]);
  });

  it("says nothing once stopped, not even a read that was in flight", async () => {
    const { client, hold, release } = node({ wars: 5_000n, usdt: 0n, head: 10n });
    const { seen, reader } = reads(client);
    hold();
    const inFlight = reader.look();
    reader.stop();
    release();
    await inFlight;
    await reader.look();
    expect(seen).toEqual([]);
  });
});

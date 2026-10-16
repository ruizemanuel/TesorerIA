import type { WeekSummaryFacts } from "@tesoreria/agent";
import { eq } from "drizzle-orm";
import { type Address, getAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/lib/db/client";
import { funds, weekSummaries } from "../src/lib/db/schema";
import { type WeekSummaryDeps, readFacts, storeFacts, writeWeekSummaries } from "../src/lib/week-summaries";
import { addLiveFund, addUser, randomAccount, testDb } from "./support/db";
import { AGENT, ANA, BETO, BLOCK, CARO, WARS } from "./support/fixtures";

const OTHER_AGENT = getAddress("0x00000000000000000000000000000000000a6e18");
const START = 1_791_764_388n;

/** The photo the chain would give of `week`: one of each thing, so a stored copy can be compared whole. */
function facts(week: bigint): WeekSummaryFacts {
  return {
    week,
    block: BLOCK + week,
    startsAt: START + week * 604_800n,
    endsAt: START + (week + 1n) * 604_800n,
    balance: 80_000n * WARS,
    dues: [
      { member: ANA, owed: 0n },
      { member: BETO, owed: 10_000n * WARS },
      { member: CARO, owed: 0n },
    ],
    contributed: 20_000n * WARS,
    reimbursements: [{ member: ANA, amount: 45_000n * WARS }],
    payments: [{ member: CARO, amount: 8_000n * WARS, note: "las pelotas" }],
    joined: [CARO],
  };
}

type Status = Awaited<ReturnType<WeekSummaryDeps["status"]>>;
const inWeek = (week: bigint, change: Partial<Status> = {}): Status => ({ week, startTime: START, agent: AGENT, closed: false, ...change });

/** A chain where each fund is as `statuses` says and each week's photo is facts(week); it keeps what it was asked. */
function fakeChain(statuses: Map<Address, Status>, failing = new Set<Address>()) {
  const asked: { fund: Address; week: bigint }[] = [];
  const deps: WeekSummaryDeps = {
    agent: AGENT,
    status: async (fund) => {
      const status = statuses.get(fund);
      if (status === undefined) throw new Error(`No status for ${fund}`);
      return status;
    },
    facts: async (fund, week) => {
      asked.push({ fund: fund.address, week });
      if (failing.has(fund.address)) throw new Error("Blockscout answered HTTP 429");
      return facts(week);
    },
  };
  return { deps, asked };
}

let db: Db;
let anaId: string;
let fundId: string;
let address: Address;

beforeEach(async () => {
  db = await testDb();
  anaId = (await addUser(db, "Ana", ANA)).id;
  address = randomAccount();
  fundId = (await addLiveFund(db, { creatorId: anaId, address, members: [anaId] })).id;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const stored = async () =>
  (await db.select().from(weekSummaries).orderBy(weekSummaries.week)).map((row) => ({
    fundId: row.fundId,
    week: row.week,
    block: row.block,
    facts: readFacts(row.facts),
  }));

describe("writeWeekSummaries: the agent's photo of each week that closes (spec, 9.4)", () => {
  it("keeps the photo of the week that just closed, once, and none during a fund's first week", async () => {
    const statuses = new Map([[address, inWeek(0n)]]);
    const { deps, asked } = fakeChain(statuses);
    await writeWeekSummaries(db, deps);
    expect(await stored()).toEqual([]);

    statuses.set(address, inWeek(3n));
    await writeWeekSummaries(db, deps);
    await writeWeekSummaries(db, deps); // the next heartbeat, still in week 3: the row is there, so nothing is read again
    expect(await stored()).toEqual([{ fundId, week: 2, block: BLOCK + 2n, facts: facts(2n) }]);
    expect(asked).toEqual([{ fund: address, week: 2n }]);
  });

  it("after a heartbeat that was down over a week, writes only the last week that closed, and never the one it skipped (Review Focus 1)", async () => {
    const statuses = new Map([[address, inWeek(3n)]]);
    const { deps, asked } = fakeChain(statuses);
    await writeWeekSummaries(db, deps);
    statuses.set(address, inWeek(5n)); // weeks 3 and 4 closed with no heartbeat in between
    await writeWeekSummaries(db, deps);
    await writeWeekSummaries(db, deps);
    expect((await stored()).map((row) => row.week)).toEqual([2, 4]);
    expect(asked.map((a) => a.week)).toEqual([2n, 4n]);
  });

  it("leaves out a closed fund and one that names another agent", async () => {
    for (const status of [inWeek(3n, { closed: true }), inWeek(3n, { agent: OTHER_AGENT })]) {
      const { deps, asked } = fakeChain(new Map([[address, status]]));
      await writeWeekSummaries(db, deps);
      expect(asked).toEqual([]);
    }
    expect(await stored()).toEqual([]);
  });

  it("never looks at a fund that isn't live", async () => {
    const creating = randomAccount();
    const other = await addLiveFund(db, { creatorId: anaId, address: creating, members: [anaId] });
    await db.update(funds).set({ status: "deploying" }).where(eq(funds.id, other.id));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, asked } = fakeChain(new Map([[address, inWeek(1n)]])); // no status for `creating`: asking would log
    await writeWeekSummaries(db, deps);
    expect(asked).toEqual([{ fund: address, week: 0n }]);
    expect(logged).not.toHaveBeenCalled();
  });

  it("goes on with the other funds when one fails, says why in the log, and never throws", async () => {
    const second = randomAccount();
    const secondId = (await addLiveFund(db, { creatorId: anaId, address: second, members: [anaId] })).id;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = fakeChain(new Map([[address, inWeek(3n)], [second, inWeek(1n)]]), new Set([address]));
    await expect(writeWeekSummaries(db, deps)).resolves.toBeUndefined();
    expect((await stored()).map((row) => [row.fundId, row.week])).toEqual([[secondId, 0]]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("Blockscout answered HTTP 429"));
  });

  it("keeps one row, and logs no failure, when two heartbeats write the same week at once", async () => {
    // The primary key would keep a single row all the same: what shows the conflict is handled is a silent log.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = fakeChain(new Map([[address, inWeek(3n)]]));
    await Promise.all([writeWeekSummaries(db, deps), writeWeekSummaries(db, deps)]);
    expect(await stored()).toHaveLength(1);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("storeFacts and readFacts", () => {
  it("keep every amount and block as a decimal string, plain JSON, and read them back as they were", () => {
    const json = storeFacts(facts(2n));
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    expect(json.balance).toBe("80000000000000000000000");
    expect(json.dues[1]).toEqual({ member: BETO, owed: "10000000000000000000000" });
    expect(readFacts(json)).toEqual(facts(2n));
  });
});

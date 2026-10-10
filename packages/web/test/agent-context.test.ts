import { type ChainView, FUND_FACTORY_BLOCK, type FundEvent } from "@tesoreria/agent";
import { eq } from "drizzle-orm";
import { getAddress } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/lib/db/client";
import { funds } from "../src/lib/db/schema";
import { addLiveFund, addUser, testDb } from "./support/db";
import { ANA, BLOCK, FUND, WARS, event, snapshot } from "./support/fixtures";

// The real view reads the chain; this one stands in for it and keeps what agentContext asked it for.
const view = vi.hoisted(() => ({ options: [] as { fromBlock?: bigint }[], spent: 0n, events: [] as FundEvent[] }));
vi.mock("@tesoreria/agent", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tesoreria/agent")>();
  const unused = async () => {
    throw new Error("not read in this test");
  };
  return {
    ...original,
    createChainView: (options: { fromBlock?: bigint }): ChainView => {
      view.options.push(options);
      return {
        gasBalance: async () => 0n,
        funds: async () => [FUND, LATER, FOREIGN],
        fund: async (address) => snapshot({ address, spentThisWeek: view.spent }),
        events: async () => view.events,
        references: unused,
        quote: unused,
        receipt: unused,
      };
    },
  };
});

const LATER = getAddress("0x00000000000000000000000000000000000f00d2");
/** A fund someone else created with the factory, naming our agent. */
const FOREIGN = getAddress("0x00000000000000000000000000000000000f00d3");

/** agentContext as the server loads it, with AGENT_SEND as given (unset: the deployed default). */
async function load(send?: "on" | "off") {
  vi.resetModules();
  vi.stubEnv("AGENT_SEND", send ?? "");
  return (await import("../src/lib/agent-context")).agentContext;
}

let db: Db;
beforeAll(async () => {
  vi.stubEnv("CHAIN_MODE", "fork");
  vi.stubEnv("RP_ID", "localhost");
  vi.stubEnv("ORIGIN", "http://localhost:3000");
  vi.stubEnv("SESSION_SECRET", "a-session-secret-for-tests-only-0123456789");
  vi.stubEnv("AGENT_PRIVATE_KEY", generatePrivateKey());
  db = await testDb();
  const ana = await addUser(db, "Ana", ANA);
  await addLiveFund(db, { creatorId: ana.id, address: FUND, members: [ana.id] });
  const later = await addLiveFund(db, { creatorId: ana.id, address: LATER, members: [ana.id] });
  await db.update(funds).set({ createdBlock: 79_800_000n }).where(eq(funds.id, later.id));
  // A draft has no address and no block yet: it neither counts nor lowers the first block.
  await db.insert(funds).values({ name: "Borrador", agreedExpense: "x", weeklyFee: 1n, weeklyCap: 1n, balanceCap: 1n, creatorId: ana.id, inviteCode: "draft" });
});

describe("agentContext", () => {
  it("runs only the live funds this web created, reading their histories from the oldest one's block", async () => {
    const agentContext = await load();
    const ctx = await agentContext(db);
    expect(await ctx.chain.funds()).toEqual([FUND, LATER]);
    expect(view.options.at(-1)?.fromBlock).toBe(79_700_000n);

    const empty = await testDb();
    await agentContext(empty);
    expect(view.options.at(-1)?.fromBlock).toBe(FUND_FACTORY_BLOCK);
  });

  it("never decides on a history with a hole in it", async () => {
    const ctx = await (await load())(db);
    view.spent = 45_000n * WARS; // the contract counts a reimbursement this week
    view.events = [];
    await ctx.chain.fund(FUND);
    await expect(ctx.chain.events(FUND, BLOCK)).rejects.toThrow(/spentInWeek/);

    view.events = [event("Reimbursement", { member: ANA, amount: 45_000n * WARS, ref: `0x${"ab".repeat(32)}`, week: 2n }, BLOCK - 10n)];
    expect(await ctx.chain.events(FUND, BLOCK)).toEqual(view.events);
  });

  it("sends only while the kill switch is on, and it is off unless set", async () => {
    expect((await (await load())(db)).send).toBe(false);
    expect((await (await load("off"))(db)).send).toBe(false);
    expect((await (await load("on"))(db)).send).toBe(true);
  });
});

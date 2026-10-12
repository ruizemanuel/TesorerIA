import { WARS as WARS_TOKEN } from "@tesoreria/agent";
import { eq } from "drizzle-orm";
import { type Address, type Hash, getAddress, pad } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "../src/lib/current-user";
import type { Db } from "../src/lib/db/client";
import { decisions, expenses, funds, operations } from "../src/lib/db/schema";
import { formatPesos } from "../src/lib/format";
import { finishOperation, recordOperation } from "../src/lib/operations";
import { HistoryGapError, loadFundScreen, loadPublicFundScreen } from "../src/lib/read-fund";
import { addLiveFund, addUser, randomAccount, testDb } from "./support/db";
import { BLOCK, CLOCK, USDT_UNIT, WARS, event, snapshot } from "./support/fixtures";

// Who may see which fund (spec, 9.2) is decided before and around the chain reads, so the chain and the
// database stand in: the database is a real (in-memory) one, the chain answers what each test sets.
const state = vi.hoisted(() => ({ db: null as unknown }));
const agent = vi.hoisted(() => ({ readFund: vi.fn(), readFundEvents: vi.fn() }));
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => state.db,
}));
vi.mock("../src/lib/chain", () => ({
  logReader: () => async () => [],
  celoClient: () => ({
    getBlock: async () => ({ timestamp: CLOCK.timestamp }),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "balanceInWars") return 87_500n * 10n ** 18n;
      throw new Error(`Unexpected read: ${functionName}`);
    },
  }),
}));
vi.mock("@tesoreria/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tesoreria/agent")>()),
  readFund: agent.readFund,
  readFundEvents: agent.readFundEvents,
}));

const waitForBlock = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../src/lib/read-your-writes", () => ({ waitForBlock }));

type Person = Awaited<ReturnType<typeof addUser>>;
const asViewer = (person: Person): CurrentUser => ({ id: person.id, name: person.name, account: getAddress(person.account) });

let db: Db;
let ana: Person;
let beto: Person;
let caro: Person;
let outsider: Person;

/** A live fund of Ana, Beto and Caro, as the chain lists them, with `change` applied to its row. */
async function liveFund(change: Partial<typeof funds.$inferInsert> = {}, onChain: Person[] = [ana, beto, caro]) {
  const address = randomAccount();
  const fund = await addLiveFund(db, { creatorId: ana.id, address, members: [ana.id, beto.id, caro.id] });
  if (Object.keys(change).length > 0) await db.update(funds).set(change).where(eq(funds.id, fund.id));
  agent.readFund.mockResolvedValue(snapshot({ address, members: onChain.map((person) => getAddress(person.account)) }));
  return address;
}

const paidByBeto = () =>
  event("Contribution", { member: getAddress(beto.account), token: WARS_TOKEN, amount: 10_000n * WARS, creditedWars: 10_000n * WARS }, BLOCK - 100n);
const texts = (screen: NonNullable<Awaited<ReturnType<typeof loadFundScreen>>>) => screen.timeline.map((item) => item.text);

beforeAll(async () => {
  db = await testDb();
  state.db = db;
  [ana, beto, caro, outsider] = [await addUser(db, "Ana"), await addUser(db, "Beto"), await addUser(db, "Caro"), await addUser(db, "Dani")] as [
    Person,
    Person,
    Person,
    Person,
  ];
});
beforeEach(() => {
  agent.readFund.mockReset();
  agent.readFundEvents.mockReset().mockResolvedValue([]);
});

describe("loadFundScreen: who sees a fund", () => {
  it("shows nothing of a private fund to someone who is not logged in, or not in it, and never touches the chain", async () => {
    const address = await liveFund();
    expect(await loadFundScreen(address, null)).toBeNull();
    expect(await loadFundScreen(address, asViewer(outsider))).toBeNull();
    expect(agent.readFund).not.toHaveBeenCalled();
  });

  it("does not hand the member's screen to an outsider because the fund's public view is on", async () => {
    const address = await liveFund({ publicView: true });
    expect(await loadFundScreen(address, asViewer(outsider))).toBeNull();
    expect(await loadFundScreen(address, null)).toBeNull();
    expect(agent.readFund).not.toHaveBeenCalled();
  });

  it("refuses the public view of a fund that has it off, even to its own members", async () => {
    const address = await liveFund({ publicView: false });
    expect(await loadFundScreen(address, null, { publicView: true })).toBeNull();
    expect(await loadFundScreen(address, asViewer(ana), { publicView: true })).toBeNull();
    expect(agent.readFund).not.toHaveBeenCalled();
  });

  it("knows only live funds: a draft or one being created has no screen, public view or not", async () => {
    for (const status of ["draft", "deploying"] as const) {
      const address = await liveFund({ status, publicView: true });
      expect(await loadFundScreen(address, asViewer(ana))).toBeNull();
      expect(await loadFundScreen(address, null, { publicView: true })).toBeNull();
    }
    expect(await loadFundScreen(randomAccount(), asViewer(ana))).toBeNull();
    expect(agent.readFund).not.toHaveBeenCalled();
  });

  it("does not block a member, whether or not the fund's public view is on", async () => {
    for (const publicView of [false, true]) {
      const address = await liveFund({ publicView });
      const screen = await loadFundScreen(address, asViewer(beto));
      expect(screen).toMatchObject({ publicView: false, viewerIsMember: true });
      expect(screen?.view.rows.map((row) => [row.name, row.isMe])).toEqual([
        ["Ana", false],
        ["Beto", true],
        ["Caro", false],
      ]);
      expect(screen?.view.me).not.toBeNull();
    }
  });

  it("reads the history from the block the fund was created in, up to the snapshot's block", async () => {
    const address = await liveFund();
    await loadFundScreen(address, asViewer(ana));
    expect(agent.readFundEvents).toHaveBeenCalledWith(expect.any(Function), address, 79_700_000n, BLOCK);
  });

  it("says which block the screen was read at, so the browser can tell when the chain has moved past it", async () => {
    const address = await liveFund();
    expect((await loadFundScreen(address, asViewer(ana)))?.block).toBe(BLOCK);
  });

  it("says it could not read the fund, instead of showing it, when the history misses a reimbursement", async () => {
    const address = await liveFund();
    agent.readFund.mockResolvedValue(snapshot({ address, members: [ana, beto, caro].map((p) => getAddress(p.account)), spentThisWeek: 45_000n * WARS }));
    await expect(loadFundScreen(address, asViewer(ana))).rejects.toThrow(HistoryGapError);
  });
});

describe("loadFundScreen: the public view", () => {
  it("shows Miembro N, in the contract's order, until the whole group agrees to show names", async () => {
    const address = await liveFund({ publicView: true, publicNames: false }, [caro, ana, beto]);
    agent.readFundEvents.mockResolvedValue([paidByBeto()]);
    const screen = (await loadFundScreen(address, null, { publicView: true }))!;
    expect(screen).toMatchObject({ publicView: true });
    expect(screen.view.rows.map((row) => row.name)).toEqual(["Miembro 1", "Miembro 2", "Miembro 3"]);
    expect(texts(screen)).toEqual([`Miembro 3 aportó ${formatPesos(10_000n * WARS)}.`]);
    // Nothing in what the screen carries has a real name.
    const everything = JSON.stringify(screen, (_, value) => (typeof value === "bigint" ? value.toString() : value));
    for (const name of ["Ana", "Beto", "Caro"]) expect(everything).not.toContain(name);
  });

  it("is read once for many hits within 45 seconds, by address however it's written, and a member's screen never is", async () => {
    const address = await liveFund({ publicView: true });
    const hits = await Promise.all([loadPublicFundScreen(address), loadPublicFundScreen(address.toLowerCase() as Address)]);
    expect(await loadPublicFundScreen(address)).toBe(hits[0]);
    expect(hits[1]).toBe(hits[0]);
    expect(hits[0]).toMatchObject({ publicView: true });
    expect(agent.readFund).toHaveBeenCalledTimes(1);

    await loadFundScreen(address, asViewer(ana));
    await loadFundScreen(address, asViewer(ana));
    expect(agent.readFund).toHaveBeenCalledTimes(3);
  });

  it("keeps no public screen of a fund that doesn't have one, so turning it on shows at once", async () => {
    const address = await liveFund({ publicView: false });
    expect(await loadPublicFundScreen(address)).toBeNull();
    await db.update(funds).set({ publicView: true }).where(eq(funds.address, address));
    expect(await loadPublicFundScreen(address)).toMatchObject({ publicView: true });
  });

  it("shows the names once the group says so, and still no one in particular is 'you'", async () => {
    const address = await liveFund({ publicView: true, publicNames: true });
    agent.readFundEvents.mockResolvedValue([paidByBeto()]);
    // Even handed a member, a public screen is no one's own.
    const screen = (await loadFundScreen(address, asViewer(ana), { publicView: true }))!;
    expect(screen.view.rows.map((row) => [row.name, row.isMe])).toEqual([
      ["Ana", false],
      ["Beto", false],
      ["Caro", false],
    ]);
    expect(screen.view.me).toBeNull();
    expect(texts(screen)).toEqual([`Beto aportó ${formatPesos(10_000n * WARS)}.`]);
  });

  it("does not read the expenses or the pending operations: they are the group's, not the public's", async () => {
    const address = await liveFund({ publicView: true, publicNames: true });
    const [fund] = await db.select().from(funds).where(eq(funds.address, address));
    await db.insert(expenses).values({
      id: crypto.randomUUID(),
      fundId: fund!.id,
      userId: ana.id,
      clientKey: "k1",
      kind: "other",
      amount: 5_000n * WARS,
      note: "pelota",
      ref: `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}`,
      status: "waiting",
    });
    await recordOperation(db, ana.id, { userOpHash: `0x${"a1".repeat(32)}`, kind: "contribute", fund: address, amount: 10_000n * WARS, token: "wars" });

    // The members do see them...
    const own = (await loadFundScreen(address, asViewer(ana)))!;
    expect(texts(own).some((text) => text.includes("que cargó Ana (pelota)"))).toBe(true);
    expect(own.timeline.filter((item) => item.pending).map((item) => item.text)).toEqual([`Tu aporte de ${formatPesos(10_000n * WARS)} está en camino.`]);

    // ...and the public view, even asked by that same member, sees neither.
    for (const viewer of [null, asViewer(ana)]) {
      const screen = (await loadFundScreen(address, viewer, { publicView: true }))!;
      expect(screen.timeline).toEqual([]);
    }
  });

  it("shows each member only their own operations on their way", async () => {
    const address = await liveFund();
    await recordOperation(db, ana.id, { userOpHash: `0x${"b1".repeat(32)}`, kind: "contribute", fund: address, amount: 10_000n * WARS, token: "wars" });
    await recordOperation(db, beto.id, { userOpHash: `0x${"b2".repeat(32)}`, kind: "contribute", fund: address, amount: 20_000n * WARS, token: "wars" });
    const forBeto = (await loadFundScreen(address, asViewer(beto)))!;
    expect(texts(forBeto)).toEqual([`Tu aporte de ${formatPesos(20_000n * WARS)} está en camino.`]);
  });

  describe("a contribution on its way", () => {
    const send = (userId: string, address: Address, hash: string, kind: "contribute" | "vote" = "contribute") =>
      recordOperation(db, userId, { userOpHash: `0x${hash.repeat(32)}`, kind, fund: address, amount: 10_000n * WARS, token: "wars" });
    const onItsWay = async (address: Address, viewer: Person) => (await loadFundScreen(address, asViewer(viewer)))!.contributionOnItsWay;

    it("is reported to the member who sent it, and to no one else", async () => {
      const address = await liveFund();
      expect(await onItsWay(address, ana)).toBe(false);
      await send(ana.id, address, "c1");
      expect(await onItsWay(address, ana)).toBe(true);
      expect(await onItsWay(address, beto)).toBe(false);
    });

    it("is not reported for a vote, for another fund's contribution, or once it has its receipt", async () => {
      const address = await liveFund();
      await send(ana.id, address, "c2", "vote");
      await send(ana.id, randomAccount(), "c3");
      expect(await onItsWay(address, ana)).toBe(false);
      await send(ana.id, address, "c4");
      await db
        .update(operations)
        .set({ transactionHash: `0x${"c4".repeat(32)}`, success: true })
        .where(eq(operations.userOpHash, `0x${"c4".repeat(32)}`));
      expect(await onItsWay(address, ana)).toBe(false);
    });

    it("is reported only within the window, so a lost one doesn't block the button for good", async () => {
      const address = await liveFund();
      await send(ana.id, address, "c5");
      const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
      await db.update(operations).set({ createdAt: ago(14) }).where(eq(operations.userOpHash, `0x${"c5".repeat(32)}`));
      expect(await onItsWay(address, ana)).toBe(true);
      await db.update(operations).set({ createdAt: ago(16) }).where(eq(operations.userOpHash, `0x${"c5".repeat(32)}`));
      expect(await onItsWay(address, ana)).toBe(false);
    });

    it("is never reported on a public view", async () => {
      const address = await liveFund({ publicView: true });
      await send(ana.id, address, "c6");
      expect((await loadFundScreen(address, asViewer(ana), { publicView: true }))!.contributionOnItsWay).toBe(false);
    });
  });
});

describe("loadFundScreen: read-your-writes", () => {
  it("reads the chain once the node has the viewer's last operation in this fund", async () => {
    const address = await liveFund();
    const landed: Hash = pad("0x0b", { size: 32 });
    await recordOperation(db, beto.id, { userOpHash: landed, kind: "vote", fund: address });
    await finishOperation(db, beto.id, { userOpHash: landed, transactionHash: landed, success: true, block: BLOCK - 5n });
    waitForBlock.mockClear();
    agent.readFund.mockClear();

    await loadFundScreen(address, asViewer(beto));
    expect(waitForBlock).toHaveBeenCalledTimes(1);
    expect(waitForBlock).toHaveBeenCalledWith(expect.anything(), BLOCK - 5n);
    expect(waitForBlock.mock.invocationCallOrder[0]!).toBeLessThan(agent.readFund.mock.invocationCallOrder[0]!);

    waitForBlock.mockClear();
    await loadFundScreen(address, asViewer(caro)); // nothing of hers landed: nothing to wait for
    expect(waitForBlock).not.toHaveBeenCalled();
  });
});

it("says once why the agent hasn't converted the USDT waiting, from its latest decision on the fund (F8)", async () => {
  const address = await liveFund();
  agent.readFund.mockResolvedValue(snapshot({ address, members: [ana, beto, caro].map((p) => getAddress(p.account)), usdtBalance: 5n * USDT_UNIT }));
  const decide = (kind: string, code: string | null, minutesAgo: number, status: string | null = null) =>
    db.insert(decisions).values({ fund: address, kind, code, reason: "for the log", status, createdAt: new Date(Date.now() - minutesAgo * 60_000) });
  const holds = async () => texts((await loadFundScreen(address, asViewer(ana)))!).filter((text) => text.startsWith("Todavía no pasé a pesos"));

  expect(await holds()).toEqual([]);
  await decide("skip", "price-gap", 30);
  await decide("skip", "price-reference", 15);
  expect(await holds()).toEqual([expect.stringContaining("el precio de referencia del dólar no está al día")]);
  await decide("convert", null, 1, "reverted");
  expect(await holds()).toEqual([expect.stringContaining("no pude hacer la operación")]);
  await decide("convert", null, 0, "success");
  expect(await holds()).toEqual([]);

  await decide("skip", "price-reference", 0);
  agent.readFund.mockResolvedValue(snapshot({ address, members: [ana, beto, caro].map((p) => getAddress(p.account)), usdtBalance: 4n * USDT_UNIT }));
  expect(await holds()).toEqual([]); // under 5 USDT the agent leaves it, and has nothing to explain
});

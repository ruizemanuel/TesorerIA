import { type FundEvent, type FundSnapshot, USDT, WARS as WARS_TOKEN, type WeekSummaryFacts } from "@tesoreria/agent";
import { and, eq, sql } from "drizzle-orm";
import { type Address, type Hash, getAddress, isAddressEqual, pad, toHex, zeroAddress } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTRIES } from "../src/lib/countries";
import type { CurrentUser } from "../src/lib/current-user";
import type { Db } from "../src/lib/db/client";
import { decisions, expenses, funds, joinRequests, memberships, operations, weekSummaries } from "../src/lib/db/schema";
import { NBSP, formatMoney, formatUsdt } from "../src/lib/format";
import { getPageCountry } from "../src/lib/i18n/server";
import { JOIN_REQUEST_REACH_DAYS } from "../src/lib/join-requests";
import { finishOperation, recordOperation } from "../src/lib/operations";
import { HistoryGapError, loadFundScreen as loadScreen, loadPublicFundScreen } from "../src/lib/read-fund";
import { storeFacts } from "../src/lib/week-summaries";
import { addLiveFund, addUser, randomAccount, testDb } from "./support/db";
import { AGENT, BLOCK, CLOCK, USDT_UNIT, WARS, event, snapshot } from "./support/fixtures";
import { en, es } from "./support/messages";

// Who may see which fund (spec, 9.2) is decided before and around the chain reads, so the chain and the
// database stand in: the database is a real (in-memory) one, the chain answers what each test sets.
const state = vi.hoisted(() => ({ db: null as unknown }));
const agent = vi.hoisted(() => ({ readFund: vi.fn(), readFundEvents: vi.fn() }));
/** Blockscout's reader and the node's, told apart by readFundEvents. */
const readers = vi.hoisted(() => ({ blockscout: async () => [], node: async () => [] }));
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => state.db,
}));
vi.mock("../src/lib/chain", () => ({
  logReader: () => readers.blockscout,
  nodeLogReader: () => readers.node,
  celoClient: () => ({
    getBlock: async () => ({ timestamp: CLOCK.timestamp }),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "balanceInWars") return 87_500n * 10n ** 18n;
      // FundV2's whole balance: a version 2 fund has no balanceInWars.
      if (functionName === "balanceInCurrency") return 92_500n * 10n ** 18n;
      // A proposal the chain still has open, with one vote and nobody else's.
      if (functionName === "getProposal") return { executed: false, deadline: CLOCK.timestamp + 86_400n };
      if (functionName === "voteCount") return 1n;
      if (functionName === "hasVoted") return false;
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

// The viewer's request: their IP's country, and the countries this run offers on top of the agent's (EXTRA_COUNTRIES).
const visitor = vi.hoisted(() => ({ ipCountry: null as string | null, extraCountries: [] as ("AR" | "MX")[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(visitor.ipCountry === null ? {} : { "x-vercel-ip-country": visitor.ipCountry }),
}));
// The summary's link to the fund (spec, 9.4) is the site's own origin.
vi.mock("../src/lib/env", () => ({ env: () => ({ ORIGIN: "https://tesoreriaia.vercel.app", EXTRA_COUNTRIES: visitor.extraCountries }) }));

/** The screens these tests read are in Spanish, unless a test says otherwise. */
const loadFundScreen = (address: Address, viewer: CurrentUser | null, options: Partial<Parameters<typeof loadScreen>[2]> = {}) =>
  loadScreen(address, viewer, { locale: "es", ...options });

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
  chainFund({ address, members: onChain.map((person) => getAddress(person.account)) });
  return address;
}

/** The history the chain answers with, from Blockscout and from the node alike (setHistory). */
let history: FundEvent[] = [];
function setHistory(events: FundEvent[]) {
  history = events;
  agent.readFundEvents.mockResolvedValue(events);
}

/**
 * The chain's fund: snapshot(change), with what each member contributed and how many proposals it has as the history
 * the test set says, so it adds up (checkHistory) unless the test makes it not.
 */
function chainFund(change: Partial<FundSnapshot>) {
  agent.readFund.mockImplementation(async () => {
    const fund = snapshot(change);
    const contributed = fund.members.map((member) =>
      history.reduce((sum, e) => (e.eventName === "Contribution" && isAddressEqual(e.args.member, member) ? sum + e.args.credited : sum), 0n),
    );
    const proposalCount = BigInt(history.filter((e) => e.eventName === "ProposalCreated").length);
    return { ...fund, contributed, totalContributed: contributed.reduce((sum, c) => sum + c, 0n), proposalCount, ...change };
  });
}

const paidByBeto = () =>
  event("Contribution", { member: getAddress(beto.account), token: WARS_TOKEN, amount: 10_000n * WARS, credited: 10_000n * WARS }, BLOCK - 100n);
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
  agent.readFundEvents.mockReset();
  setHistory([]);
  visitor.ipCountry = null;
  visitor.extraCountries = [];
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
    chainFund({ address, members: [ana, beto, caro].map((p) => getAddress(p.account)), spentThisWeek: 45_000n * WARS });
    await expect(loadFundScreen(address, asViewer(ana))).rejects.toThrow(HistoryGapError);
  });

  it("shows a contribution Blockscout's history misses, read from the node, once the history adds up with it", async () => {
    // 3/11: Blockscout's logs by address were a day behind while its block number was current.
    const address = await liveFund();
    setHistory([paidByBeto()]);
    agent.readFundEvents.mockImplementation(async (reader: unknown, _fund: Address, fromBlock: bigint, toBlock: bigint) =>
      reader === readers.node ? history.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock) : [],
    );
    const screen = await loadFundScreen(address, asViewer(ana));
    expect(texts(screen!)).toEqual([`Beto aportó ${formatMoney(10_000n * WARS, es)}.`]);
  });
});

describe("loadFundScreen: the public view", () => {
  it("shows Miembro N, in the contract's order, until the whole group agrees to show names", async () => {
    const address = await liveFund({ publicView: true, publicNames: false }, [caro, ana, beto]);
    setHistory([paidByBeto()]);
    const screen = (await loadFundScreen(address, null, { publicView: true }))!;
    expect(screen).toMatchObject({ publicView: true });
    expect(screen.view.rows.map((row) => row.name)).toEqual(["Miembro 1", "Miembro 2", "Miembro 3"]);
    expect(texts(screen)).toEqual([`Miembro 3 aportó ${formatMoney(10_000n * WARS, es)}.`]);
    // Nothing in what the screen carries has a real name.
    const everything = JSON.stringify(screen, (_, value) => (typeof value === "bigint" ? value.toString() : value));
    for (const name of ["Ana", "Beto", "Caro"]) expect(everything).not.toContain(name);
  });

  it("is read once for many hits within 45 seconds, by address however it's written, and a member's screen never is", async () => {
    const address = await liveFund({ publicView: true });
    const hits = await Promise.all([loadPublicFundScreen(address, "es"), loadPublicFundScreen(address.toLowerCase() as Address, "es")]);
    expect(await loadPublicFundScreen(address, "es")).toBe(hits[0]);
    expect(hits[1]).toBe(hits[0]);
    expect(hits[0]).toMatchObject({ publicView: true });
    expect(agent.readFund).toHaveBeenCalledTimes(1);

    await loadFundScreen(address, asViewer(ana));
    await loadFundScreen(address, asViewer(ana));
    expect(agent.readFund).toHaveBeenCalledTimes(3);
  });

  it("keeps the public screen apart per language, each read once within 45 seconds", async () => {
    const address = await liveFund({ publicView: true, publicNames: false });
    setHistory([paidByBeto()]);
    const spanish = (await loadPublicFundScreen(address, "es"))!;
    const english = (await loadPublicFundScreen(address, "en"))!;
    expect(spanish.view.rows[0]!.name).toBe("Miembro 1");
    expect(english.view.rows[0]!.name).toBe("Member 1");
    expect(texts(spanish)).toEqual([`Miembro 2 aportó ${formatMoney(10_000n * WARS, es)}.`]);
    expect(texts(english)).toEqual([`Member 2 contributed ${formatMoney(10_000n * WARS, en)}.`]);

    // Each language is its own entry: asking again gives each its own screen back, without reading the chain again.
    expect(await loadPublicFundScreen(address, "es")).toBe(spanish);
    expect(await loadPublicFundScreen(address, "en")).toBe(english);
    expect(await loadPublicFundScreen(address.toLowerCase() as Address, "en")).toBe(english);
    expect(agent.readFund).toHaveBeenCalledTimes(2);
  });

  it("writes a member's own screen in the language asked, the names and the amounts too", async () => {
    const address = await liveFund();
    setHistory([paidByBeto()]);
    const screen = (await loadFundScreen(address, asViewer(ana), { locale: "en" }))!;
    expect(texts(screen)).toEqual([`Beto contributed ${formatMoney(10_000n * WARS, en)}.`]);
    expect(screen.view.rows.map((row) => row.name)).toEqual(["Ana", "Beto", "Caro"]);
  });

  it("keeps no public screen of a fund that doesn't have one, so turning it on shows at once", async () => {
    const address = await liveFund({ publicView: false });
    expect(await loadPublicFundScreen(address, "es")).toBeNull();
    await db.update(funds).set({ publicView: true }).where(eq(funds.address, address));
    expect(await loadPublicFundScreen(address, "es")).toMatchObject({ publicView: true });
  });

  it("shows the names once the group says so, and still no one in particular is 'you'", async () => {
    const address = await liveFund({ publicView: true, publicNames: true });
    setHistory([paidByBeto()]);
    // Even handed a member, a public screen is no one's own.
    const screen = (await loadFundScreen(address, asViewer(ana), { publicView: true }))!;
    expect(screen.view.rows.map((row) => [row.name, row.isMe])).toEqual([
      ["Ana", false],
      ["Beto", false],
      ["Caro", false],
    ]);
    expect(screen.view.me).toBeNull();
    expect(texts(screen)).toEqual([`Beto aportó ${formatMoney(10_000n * WARS, es)}.`]);
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
    expect(own.timeline.filter((item) => item.pending).map((item) => item.text)).toEqual([`Tu aporte de ${formatMoney(10_000n * WARS, es)} está en camino.`]);

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
    expect(texts(forBeto)).toEqual([`Tu aporte de ${formatMoney(20_000n * WARS, es)} está en camino.`]);
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

  describe("a pass to pesos on its way (spec, 9.2)", () => {
    const pass = (userId: string, hash: string) =>
      recordOperation(db, userId, { userOpHash: `0x${hash.repeat(32)}`, kind: "cash-out", amount: 10_000n * WARS, token: "wars" });
    const onItsWay = async (address: Address, viewer: Person) => (await loadFundScreen(address, asViewer(viewer)))!.cashOutOnItsWay;

    it("is reported to the member who sent it, in any of their funds, and to no one else; it's not a contribution", async () => {
      const address = await liveFund();
      expect(await onItsWay(address, caro)).toBe(false);
      await pass(caro.id, "d1");
      expect(await onItsWay(address, caro)).toBe(true);
      expect(await onItsWay(address, beto)).toBe(false);
      const screen = (await loadFundScreen(address, asViewer(caro)))!;
      expect(screen.contributionOnItsWay).toBe(false);
      expect(texts(screen)).toEqual([]); // not in the fund's timeline
    });

    it("is never reported on a public view", async () => {
      const address = await liveFund({ publicView: true });
      await pass(caro.id, "d2");
      expect((await loadFundScreen(address, asViewer(caro), { publicView: true }))!.cashOutOnItsWay).toBe(false);
    });
  });
});

describe("loadFundScreen: what converting USDT lost (conversion-loss design)", () => {
  it("takes it off the dues of the member whose USDT it was", async () => {
    const address = await liveFund();
    const caroAccount = getAddress(caro.account);
    // By week 2 Caro put in 20.000 in wARS and 6 USDT credited at 10.000, which the agent converted into 9.940.
    setHistory([
      event("Contribution", { member: caroAccount, token: WARS_TOKEN, amount: 20_000n * WARS, credited: 20_000n * WARS }, BLOCK - 500n),
      event("Contribution", { member: caroAccount, token: USDT, amount: 6n * USDT_UNIT, credited: 10_000n * WARS }, BLOCK - 400n),
      event("Conversion", { dollarIn: 6n * USDT_UNIT, currencyOut: 9_940n * WARS }, BLOCK - 390n),
    ]);
    const screen = (await loadFundScreen(address, asViewer(caro)))!;
    expect(screen.view.rows[2]?.owed).toBe(60n * WARS);
    expect(texts(screen).filter((text) => text.startsWith("Pasé a pesos"))).toEqual([
      `Pasé a pesos los ${formatUsdt(6n * USDT_UNIT, es)} que entraron: ${formatMoney(9_940n * WARS, es)}, ${formatMoney(60n * WARS, es)} menos de lo que valían al aportarlos. Esa diferencia la pone Caro.`,
    ]);
  });
});

describe("loadFundScreen: a contribution given back (spec, 7.3)", () => {
  it("takes it off the dues and tells it as one, found by the transaction of the expense the agent proposed it for", async () => {
    const address = await liveFund();
    const [fund] = await db.select({ id: funds.id }).from(funds).where(eq(funds.address, address));
    const caroAccount = getAddress(caro.account);
    const tx = (n: number) => pad(toHex(n), { size: 32 });
    // By week 2 Caro put in 35.000, 10.000 of them by mistake, and proposal 0 gave those back: Caro owes 5.000.
    setHistory([
      event("Contribution", { member: caroAccount, token: WARS_TOKEN, amount: 35_000n * WARS, credited: 35_000n * WARS }, BLOCK - 500n),
      event("ProposalCreated", { id: 0n, action: 0, a: caroAccount, b: zeroAddress, amount: 10_000n * WARS, proposer: AGENT, note: "deposité en otro fondo" }, BLOCK - 400n, 77),
      event("Payment", { member: caroAccount, amount: 10_000n * WARS }, BLOCK - 300n, 78),
      { ...event("ProposalExecuted", { id: 0n }, BLOCK - 300n, 78), logIndex: 1 },
    ]);
    const expense = (kind: "other" | "give-back", proposedIn: Hash) => ({
      id: crypto.randomUUID(),
      fundId: fund!.id,
      userId: caro.id,
      clientKey: `k-${proposedIn}`,
      kind,
      amount: 10_000n * WARS,
      note: "deposité en otro fondo",
      ref: `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}`,
      status: "proposed" as const,
      tx: proposedIn,
      sentAction: "propose-payment" as const,
    });
    await db.insert(expenses).values(expense("other", tx(77)));
    const caroOwes = async () => (await loadFundScreen(address, asViewer(caro)))!.view.rows[2]?.owed;
    expect(await caroOwes()).toBe(0n); // an "other" expense: a payment, and the 35.000 all count

    await db.update(expenses).set({ kind: "give-back" }).where(eq(expenses.fundId, fund!.id));
    const screen = (await loadFundScreen(address, asViewer(caro)))!;
    expect(screen.view.rows[2]?.owed).toBe(5_000n * WARS);
    expect(texts(screen).filter((text) => text.includes("devol"))).toEqual([
      `El fondo le devolvió ${formatMoney(10_000n * WARS, es)} de su aporte a Caro: la propuesta se aprobó.`,
      `Propuse devolverle ${formatMoney(10_000n * WARS, es)} de su aporte a Caro (deposité en otro fondo). Lleva 1 de 2 votos.`,
    ]);
    // The public view counts it the same: the dues are the group's list.
    await db.update(funds).set({ publicView: true }).where(eq(funds.id, fund!.id));
    expect((await loadFundScreen(address, null, { publicView: true }))!.view.rows[2]?.owed).toBe(5_000n * WARS);

    // A give-back expense the agent hasn't proposed yet, or one in another transaction, marks nothing.
    await db.update(expenses).set({ tx: tx(99) }).where(eq(expenses.fundId, fund!.id));
    expect(await caroOwes()).toBe(0n);
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
  chainFund({ address, members: [ana, beto, caro].map((p) => getAddress(p.account)), dollarBalance: 5n * USDT_UNIT });
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
  chainFund({ address, members: [ana, beto, caro].map((p) => getAddress(p.account)), dollarBalance: 4n * USDT_UNIT });
  expect(await holds()).toEqual([]); // under 5 USDT the agent leaves it, and has nothing to explain
});

it("gives no reason from a decision over half an hour old: it may be about other USDT, and the agent decides again soon", async () => {
  const address = await liveFund();
  chainFund({ address, members: [ana, beto, caro].map((p) => getAddress(p.account)), dollarBalance: 6_230_000n });
  const blocked = (minutesAgo: number) =>
    db.insert(decisions).values({ fund: address, kind: "blocked", reason: "Could not run the fund: RPC Request failed.", createdAt: new Date(Date.now() - minutesAgo * 60_000) });
  const holds = async () => texts((await loadFundScreen(address, asViewer(ana)))!).filter((text) => text.startsWith("Todavía no pasé a pesos"));

  // 13/10: a heartbeat couldn't read the fund at 01:32, with nothing to convert; USDT that came the next afternoon isn't why.
  await blocked(13 * 60);
  expect(await holds()).toEqual([]);
  await blocked(31);
  expect(await holds()).toEqual([]);
  await blocked(29);
  expect(await holds()).toEqual([expect.stringContaining("no pude hacer la operación")]);
});

it("explains the USDT waiting only with the agent's conversion decisions on this fund", async () => {
  const address = await liveFund();
  chainFund({ address, members: [ana, beto, caro].map((p) => getAddress(p.account)), dollarBalance: 5n * USDT_UNIT });
  const holds = async () => texts((await loadFundScreen(address, asViewer(ana)))!).filter((text) => text.startsWith("Todavía no pasé a pesos"));

  await db.insert(decisions).values({ fund: randomAccount(), kind: "skip", code: "price-gap", reason: "another fund's" });
  const [fund] = await db.select().from(funds).where(eq(funds.address, address));
  const expenseId = crypto.randomUUID();
  await db.insert(expenses).values({
    id: expenseId,
    fundId: fund!.id,
    userId: ana.id,
    clientKey: "k-hold",
    kind: "agreed",
    amount: 5_000n * WARS,
    note: "cancha",
    ref: `0x${crypto.randomUUID().replaceAll("-", "").padEnd(64, "0")}`,
    status: "waiting",
  });
  // A reimbursement the agent couldn't send: blocked too, but about the expense, not the USDT.
  await db.insert(decisions).values({ fund: address, expenseId, kind: "blocked", reason: "The agent holds 0 USDT for gas" });
  expect(await holds()).toEqual([]);
});

describe("loadFundScreen: a version 2 fund", () => {
  /** A live version 2 fund of Ana, Beto and Caro, wARS with USDT, as the chain reads it with `change`. */
  async function liveFundV2(change: Partial<FundSnapshot> = {}) {
    const address = randomAccount();
    await addLiveFund(db, { creatorId: ana.id, address, members: [ana.id, beto.id, caro.id], version: 2 });
    chainFund({ address, members: [ana, beto, caro].map((person) => getAddress(person.account)), version: 2, feeBps: 25, ...change });
    return address;
  }
  const caroAccount = () => getAddress(caro.account);
  const holds = async (address: Address) =>
    texts((await loadFundScreen(address, asViewer(ana)))!).filter((text) => text.startsWith("Todavía no pasé a pesos"));
  const decide = (address: Address, kind: string, code: string | null, minutesAgo: number, action: Record<string, string> | null = null) =>
    db.insert(decisions).values({ fund: address, kind, code, reason: "for the log", action, createdAt: new Date(Date.now() - minutesAgo * 60_000) });
  /** Caro sent 6 USDT that wait, pending under her name, and 20 more reached the fund without contributeDollar. */
  const caroPending = () => ({
    pendingDollar: [0n, 0n, 6n * USDT_UNIT],
    pendingValue: [0n, 0n, 10_020n * WARS],
    totalPendingDollar: 6n * USDT_UNIT,
    dollarBalance: 26n * USDT_UNIT,
  });

  it("reads its balance with balanceInCurrency", async () => {
    const address = await liveFundV2();
    expect((await loadFundScreen(address, asViewer(ana)))!.view.balance).toBe(92_500n * WARS);
  });

  it("a v2 fund's hold counts its pending dollars, not what was sent to it directly", async () => {
    // 20 USDT sent straight to the fund are nobody's: the agent never converts them, so there's nothing to explain.
    const address = await liveFundV2({ dollarBalance: 20n * USDT_UNIT });
    await decide(address, "skip", "price-reference", 1);
    expect(await holds(address)).toEqual([]);

    setHistory([event("Contribution", { member: caroAccount(), token: USDT, amount: 6n * USDT_UNIT, credited: 0n }, BLOCK - 100n)]);
    chainFund({ address, members: [ana, beto, caro].map((person) => getAddress(person.account)), version: 2, feeBps: 25, ...caroPending() });
    expect(await holds(address)).toEqual([expect.stringContaining(`Todavía no pasé a pesos ${formatUsdt(6n * USDT_UNIT, es)}: el precio de referencia`)]);
  });

  it("a v2 member sees how many proposals they have left, and how much they can ask back", async () => {
    // Caro put in $ 10.025,07, which credited $ 10.000,007325; this week the agent proposed two of Beto's expenses.
    const credited = 10_000_007_325_000_000_000_000n;
    const betoAccount = getAddress(beto.account);
    const proposal = (id: bigint, block: bigint) =>
      event("ProposalCreated", { id, action: 0, a: betoAccount, b: zeroAddress, amount: 1_000n * WARS, proposer: AGENT, note: "pelota" }, block);
    setHistory([
      event("Contribution", { member: caroAccount(), token: WARS_TOKEN, amount: 10_025_070_000_000_000_000_000n, credited }, BLOCK - 900n),
      proposal(0n, BLOCK - 200n),
      proposal(1n, BLOCK - 100n),
    ]);
    const address = await liveFundV2({ agentProposalsThisWeek: 2n });
    const seen = async (person: Person) => {
      const screen = (await loadFundScreen(address, asViewer(person)))!;
      return [screen.proposalsLeft, screen.giveBackMax];
    };
    // 8 left this week: Caro keeps all but Ana's one; Beto, who had two, all but Ana's and Caro's. To the wei.
    expect(await seen(caro)).toEqual([7, credited]);
    expect(await seen(beto)).toEqual([6, 0n]);
    // The public view is no one's.
    await db.update(funds).set({ publicView: true }).where(eq(funds.address, address));
    const shown = (await loadFundScreen(address, null, { publicView: true }))!;
    expect([shown.proposalsLeft, shown.giveBackMax]).toEqual([null, null]);
  });

  it("a v1 fund has no weekly proposals to count, and its give-backs are payments: neither number", async () => {
    setHistory([paidByBeto()]);
    const screen = (await loadFundScreen(await liveFund(), asViewer(beto)))!;
    expect([screen.proposalsLeft, screen.giveBackMax]).toEqual([null, null]);
  });

  it("tells the fee sent with the fund's own percent", async () => {
    setHistory([event("FeePaid", { amount: 200n * WARS }, BLOCK - 100n)]);
    const address = await liveFundV2();
    expect(texts((await loadFundScreen(address, asViewer(ana)))!)).toEqual([
      `Pasé ${formatMoney(200n * WARS, es)} de la comisión del 0,25${NBSP}% a TesorerIA, para cubrir lo que cuestan las operaciones del fondo.`,
    ]);
  });

  it("takes no failed fee payment for a reason the dollars wait", async () => {
    // The heartbeat sends the week's fee before converting: a fee it couldn't send says nothing about the dollars.
    setHistory([event("Contribution", { member: caroAccount(), token: USDT, amount: 6n * USDT_UNIT, credited: 0n }, BLOCK - 100n)]);
    const address = await liveFundV2(caroPending());
    await decide(address, "skip", "price-reference", 2);
    await decide(address, "blocked", null, 1, { kind: "pay-fee" });
    expect(await holds(address)).toEqual([expect.stringContaining("el precio de referencia del dólar no está al día")]);
  });
});

describe("loadFundScreen: the fund's country (spec, 6)", () => {
  const MXN = COUNTRIES.MX.currency.token;
  /** A live version 2 fund of Ana, Beto and Caro in `currency`, as the chain reads it with `change`. */
  async function liveFundIn(currency: Address, change: Partial<FundSnapshot> = {}) {
    const address = randomAccount();
    await addLiveFund(db, { creatorId: ana.id, address, members: [ana.id, beto.id, caro.id], version: 2, currency });
    chainFund({ address, members: [ana, beto, caro].map((person) => getAddress(person.account)), version: 2, currency, feeBps: 25, ...change });
    return address;
  }

  it("speaks a wMXN fund's country even to a viewer from Argentina", async () => {
    visitor.ipCountry = "AR";
    setHistory([event("Contribution", { member: getAddress(beto.account), token: MXN, amount: 1_000n * WARS, credited: 1_000n * WARS }, BLOCK - 100n)]);
    const address = await liveFundIn(MXN, { dollar: null, pool: null });
    const screen = await loadFundScreen(address, asViewer(ana), { locale: "es" });
    expect(screen!.country).toBe("MX");
    expect(screen!.timeline.some((item) => /\$\d{1,3}(,\d{3})*(\.\d{2})?/.test(item.text))).toBe(true);
  });

  it("keeps the football fund in Rioplatense for a viewer with a Mexican IP", async () => {
    // Outside a fund, this viewer's pages are Mexico's: the IP says so, and this run offers Mexico.
    visitor.ipCountry = "MX";
    visitor.extraCountries = ["MX"];
    expect(await getPageCountry()).toBe("MX");
    setHistory([event("FeePaid", { amount: 10_000n * WARS }, BLOCK - 100n)]);
    const address = await liveFundIn(WARS_TOKEN);
    const screen = await loadFundScreen(address, asViewer(ana), { locale: "es" });
    expect(screen!.country).toBe("AR");
    // Argentina's amount and percent, in the Rioplatense sentence: the neutral one says "Envié $10,000 … del 0.25%".
    expect(texts(screen!)).toEqual([
      `Pasé $${NBSP}10.000 de la comisión del 0,25${NBSP}% a TesorerIA, para cubrir lo que cuestan las operaciones del fondo.`,
    ]);
  });

  it("keeps one public screen per fund and per language: the country comes with the fund", async () => {
    const address = await liveFundIn(MXN, { dollar: null, pool: null });
    await db.update(funds).set({ publicView: true }).where(eq(funds.address, address));
    const shown = (await loadPublicFundScreen(address, "es"))!;
    expect(shown.country).toBe("MX");
    expect(await loadPublicFundScreen(address.toLowerCase() as Address, "es")).toBe(shown);
  });
});

describe("loadFundScreen: the week summaries (spec, 9.4)", () => {
  /** Week 1 (the people's 2) of Ana, Beto and Caro, as the agent kept it: Beto owes a week. */
  const facts = (): WeekSummaryFacts => ({
    week: 1n,
    block: BLOCK - 604_800n,
    startsAt: 1_791_764_388n + 604_800n,
    endsAt: 1_791_764_388n + 2n * 604_800n,
    balance: 20_000n * WARS,
    dues: [ana, beto, caro].map((person) => ({ member: getAddress(person.account), owed: person === beto ? 10_000n * WARS : 0n })),
    contributed: 20_000n * WARS,
    reimbursements: [],
    payments: [],
    joined: [],
  });

  async function withSummary(change: Partial<typeof funds.$inferInsert> = {}) {
    const address = await liveFund(change);
    const [fund] = await db.select().from(funds).where(eq(funds.address, address));
    await db.insert(weekSummaries).values({ fundId: fund!.id, week: 1, block: BLOCK - 604_800n, facts: storeFacts(facts()) });
    return address;
  }

  it("gives a member each summary as the text for the group, with the link to the fund, and its movement", async () => {
    const address = await withSummary();
    const screen = await loadFundScreen(address, asViewer(ana));
    expect(screen?.weekSummaries).toHaveLength(1);
    const [summary] = screen!.weekSummaries;
    expect(summary?.week).toBe(1);
    expect(summary?.text).toContain("Resumen de la semana 2 (del 18/10 al 25/10)");
    expect(summary?.text).toContain(`· Beto, ${formatMoney(10_000n * WARS, es)}`);
    expect(summary?.text.endsWith(`Para aportar: https://tesoreriaia.vercel.app/f/${address}`)).toBe(true);
    const item = screen?.timeline.find((i) => i.id === "summary:1");
    expect(item).toMatchObject({ actor: { kind: "agent" }, text: "Cerré la semana 2. Te dejo el resumen para el grupo.", action: { kind: "summary", week: 1 } });
  });

  it("shows the public view the same summary with 'Miembro N', and no link", async () => {
    const address = await withSummary({ publicView: true });
    const screen = await loadFundScreen(address, null, { publicView: true });
    const text = screen?.weekSummaries[0]?.text ?? "";
    expect(text).toContain(`· Miembro 2, ${formatMoney(10_000n * WARS, es)}`);
    expect(text).not.toContain("Beto");
    expect(text).not.toContain("Para aportar");
  });

  it("writes them in the page's language", async () => {
    const address = await withSummary();
    const screen = await loadFundScreen(address, asViewer(ana), { locale: "en" });
    expect(screen?.weekSummaries[0]?.text).toContain("Week 2 summary (Oct 18 to Oct 25)");
  });
});

describe("loadFundScreen: the invitation link, for Tu cuenta (spec, 9.4 B)", () => {
  const inviteCodeOf = async (address: Address) =>
    (await db.select({ code: funds.inviteCode }).from(funds).where(eq(funds.address, address)))[0]!.code;

  it("gives a member the link the fund was shared with, which asks to join once the fund is live", async () => {
    const address = await liveFund();
    const screen = await loadFundScreen(address, asViewer(beto));
    expect(screen?.invite).toBe(`https://tesoreriaia.vercel.app/invitacion/${await inviteCodeOf(address)}`);
  });

  it("gives none on the public view, nor once the fund has 10 members or is closed: no one else could join it", async () => {
    const address = await liveFund({ publicView: true });
    expect((await loadFundScreen(address, null, { publicView: true }))?.invite).toBeNull();

    const ten = [ana, beto, caro].map((person) => getAddress(person.account));
    while (ten.length < 10) ten.push(randomAccount());
    chainFund({ address, members: ten });
    expect((await loadFundScreen(address, asViewer(ana)))?.invite).toBeNull();

    chainFund({ address, members: [ana, beto, caro].map((person) => getAddress(person.account)), closed: true });
    expect((await loadFundScreen(address, asViewer(ana)))?.invite).toBeNull();
  });
});

describe("loadFundScreen: someone who asked to join (spec, 9.4)", () => {
  const fundIdOf = async (address: Address) => (await db.select({ id: funds.id }).from(funds).where(eq(funds.address, address)))[0]!.id;

  it("lets in someone the chain added since their request, from any device, before anyone else looked (Review Focus 3)", async () => {
    const lucas = await addUser(db, "Lucas");
    const address = await liveFund({}, [ana, beto, caro, lucas]);
    const fundId = await fundIdOf(address);
    await db.insert(joinRequests).values({ fundId, userId: lucas.id });

    const screen = await loadFundScreen(address, asViewer(lucas));
    expect(screen).toMatchObject({ viewerIsMember: true });
    expect(screen?.view.rows.map((row) => [row.name, row.isMe])).toContainEqual(["Lucas", true]);
    expect(await db.$count(memberships, and(eq(memberships.fundId, fundId), eq(memberships.userId, lucas.id)))).toBe(1);
    expect(await db.$count(joinRequests, eq(joinRequests.fundId, fundId))).toBe(0);
  });

  it("still shows nothing to someone the chain hasn't taken yet, and to anyone without a request, before reading it", async () => {
    const lucas = await addUser(db, "Lucas");
    const address = await liveFund();
    await db.insert(joinRequests).values({ fundId: await fundIdOf(address), userId: lucas.id });
    expect(await loadFundScreen(address, asViewer(lucas))).toBeNull();
    agent.readFund.mockClear();
    expect(await loadFundScreen(address, asViewer(outsider))).toBeNull();
    expect(agent.readFund).not.toHaveBeenCalled();
  });

  it("shows the group who asked, with Proponer sumarlo, until the fund has 10 members on the chain (Review Focus 4)", async () => {
    const lucas = await addUser(db, "Lucas");
    const address = await liveFund();
    await db.insert(joinRequests).values({ fundId: await fundIdOf(address), userId: lucas.id });
    const asked = (screen: Awaited<ReturnType<typeof loadFundScreen>>) => screen?.timeline.find((item) => item.text === "Lucas pidió sumarse al fondo.");
    expect(asked(await loadFundScreen(address, asViewer(ana)))?.action).toEqual({ kind: "propose-member", account: getAddress(lucas.account), canPropose: true });

    const ten = [ana, beto, caro].map((person) => getAddress(person.account));
    while (ten.length < 10) ten.push(randomAccount());
    chainFund({ address, members: ten });
    expect(asked(await loadFundScreen(address, asViewer(ana)))?.action).toMatchObject({ canPropose: false });
  });

  it("keeps an expired request in Movimientos while a proposal made in time could still carry it out, and drops it past that", async () => {
    const [lucas, mora, nico] = [await addUser(db, "Lucas"), await addUser(db, "Mora"), await addUser(db, "Nico")];
    const address = await liveFund();
    const fundId = await fundIdOf(address);
    const askedDaysAgo = (userId: string, days: number) =>
      db.insert(joinRequests).values({ fundId, userId, createdAt: sql`now() - ${days} * interval '1 day'` });
    await askedDaysAgo(lucas.id, JOIN_REQUEST_REACH_DAYS - 1);
    await askedDaysAgo(mora.id, JOIN_REQUEST_REACH_DAYS + 1);
    await askedDaysAgo(nico.id, 1);

    const screen = await loadFundScreen(address, asViewer(ana));
    // Newest first: Nico's open request, then Lucas's, which expired 6 days ago; Mora's is past reach and gone.
    expect(texts(screen!)).toEqual(["Nico pidió sumarse al fondo.", "Venció el pedido de Lucas."]);
    expect(screen!.timeline.find((item) => item.text === "Venció el pedido de Lucas.")?.action).toBeUndefined();
    // Gone from Movimientos only: the request is still there for the chain to admit whoever it took in (admitMembers).
    expect(await db.$count(joinRequests, eq(joinRequests.fundId, fundId))).toBe(3);
  });

  it("still names a requester in the proposal to add them, whatever the age of their request", async () => {
    const address = await liveFund();
    const fundId = await fundIdOf(address);
    // A proposal made in time has expired by 14 days; the names don't depend on that, nor on the request showing.
    for (const days of [JOIN_REQUEST_REACH_DAYS - 1, JOIN_REQUEST_REACH_DAYS + 1]) {
      const lucas = await addUser(db, "Lucas");
      await db.insert(joinRequests).values({ fundId, userId: lucas.id, createdAt: sql`now() - ${days} * interval '1 day'` });
      setHistory([
        event("ProposalCreated", { id: 4n, action: 1, a: getAddress(lucas.account), b: zeroAddress, amount: 0n, proposer: getAddress(ana.account), note: "" }, BLOCK - 100n),
      ]);
      const screen = await loadFundScreen(address, asViewer(ana));
      expect(texts(screen!), `${days} days old`).toEqual(["Ana propuso sumar a Lucas al fondo. Lleva 1 de 2 votos."]);
      await db.delete(joinRequests).where(eq(joinRequests.userId, lucas.id));
    }
  });

  it("warns on an open request named like a member of the fund, not like someone who left it, and only where Proponer sumarlo shows", async () => {
    const [beto2, dario, dario2] = [await addUser(db, "Betó"), await addUser(db, "Dario"), await addUser(db, "Darío")];
    const address = await liveFund();
    const fundId = await fundIdOf(address);
    // Dario is in the fund's rows but not on the chain's list: he left, and the database keeps his row.
    await db.insert(memberships).values({ fundId, userId: dario.id });
    for (const person of [beto2, dario2]) await db.insert(joinRequests).values({ fundId, userId: person.id });
    /** The Proponer sumarlo action of the request that reads `text`. */
    const proposing = (screen: Awaited<ReturnType<typeof loadFundScreen>>, text: string) => {
      const action = screen!.timeline.find((entry) => entry.text === text)?.action;
      return action?.kind === "propose-member" ? action : undefined;
    };

    const screen = await loadFundScreen(address, asViewer(ana));
    expect(proposing(screen, "Betó pidió sumarse al fondo.")?.headsUp).toBe(
      "Ojo: hay otra persona que se llama Betó. Antes de proponer, confirmá en el grupo que es quien esperan.",
    );
    expect(proposing(screen, "Darío pidió sumarse al fondo.")).not.toHaveProperty("headsUp");

    const english = await loadFundScreen(address, asViewer(ana), { locale: "en" });
    expect(proposing(english, "Betó asked to join the fund.")?.headsUp).toBe(
      "Heads up: someone else here is also called Betó. Before you propose, check with the group that this is who you're expecting.",
    );

    // A fund with its 10 members can't take another: no button, so no line.
    const ten = [ana, beto, caro].map((person) => getAddress(person.account));
    while (ten.length < 10) ten.push(randomAccount());
    chainFund({ address, members: ten });
    expect(proposing(await loadFundScreen(address, asViewer(ana)), "Betó pidió sumarse al fondo.")).toEqual({
      kind: "propose-member",
      account: getAddress(beto2.account),
      canPropose: false,
    });
  });

  it("never shows a request on the public view, nor the name of who asked", async () => {
    const lucas = await addUser(db, "Lucas");
    const address = await liveFund({ publicView: true, publicNames: true });
    await db.insert(joinRequests).values({ fundId: await fundIdOf(address), userId: lucas.id });
    const screen = await loadFundScreen(address, null, { publicView: true });
    expect(texts(screen!).some((text) => text.includes("Lucas"))).toBe(false);
  });
});

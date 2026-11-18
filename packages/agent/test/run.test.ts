import { type Address, type Hash, decodeFunctionData, getAddress, pad, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { fundAbi, fundV2Abi } from "../src/abi";
import { WARS } from "../src/chain";
import { type Currency, currencyOf, servedProblem } from "../src/currencies";
import type { FundEvent } from "../src/events";
import type { Expense } from "../src/expense";
import { type FundRef, type FundSnapshot, weekStartBlock } from "../src/fund";
import type { ConversionQuote, References } from "../src/market";
import { type AgentContext, type ChainView, MIN_GAS_USDT, handleExpense, runHeartbeat } from "../src/run";
import type { AgentSigner, AgentTransaction } from "../src/signer";
import {
  AGENT,
  BLOCK,
  FUND,
  MEMBERS,
  OUTSIDER,
  USDT_UNIT,
  WARS_UNIT,
  converted,
  feePaid,
  fundSnapshot,
  fundSnapshotV2,
  fundSnapshotWithPending,
  fundSnapshotWithoutDollar,
  proposed,
  ref,
  reimbursed,
} from "./support/fixtures";

const NOW = 1_791_561_510n;
const HASH: Hash = pad("0x7a", { size: 32 });
const REFERENCES: References = {
  currencyUsd: { answer: 160_790_320_000n, decimals: 8, updatedAt: 1_791_555_995n },
  dollarUsd: { answer: 99_913_512n, decimals: 8, updatedAt: 1_791_561_336n },
};
const QUOTE: ConversionQuote = {
  dollarAmount: 300n * USDT_UNIT,
  quotedCurrency: 482_243_292_884_944_290_611_892n,
  twapCurrency: 482_300_000_000_000_000_000_000n,
  poolCurrency: 106_669_036_955_606_543_270_134_078n,
};
const MEMBER = MEMBERS[1] as Address;
const WARS_CURRENCY = currencyOf(WARS) as Currency;

/** A chain with the given funds and histories; everything else as on 2026-10-09. */
function fakeChain(
  funds: FundSnapshot[],
  {
    events = [] as FundEvent[],
    gas = 1n * USDT_UNIT,
    references = REFERENCES,
    failing = [] as Address[],
    receiptError,
  }: { events?: FundEvent[]; gas?: bigint; references?: References; failing?: Address[]; receiptError?: Error } = {},
): ChainView {
  return {
    gasBalance: async () => gas,
    funds: async () => funds.map((f): FundRef => ({ address: f.address, version: f.version })),
    fund: async ({ address }) => {
      if (failing.includes(address)) throw new Error("RPC down");
      const fund = funds.find((f) => f.address === address);
      if (fund === undefined) throw new Error(`no fund ${address}`);
      return fund;
    },
    events: async () => events,
    references: async () => references,
    quote: async (_fund, dollarAmount) => ({ ...QUOTE, dollarAmount }),
    receipt: async () => {
      if (receiptError) throw receiptError;
      return "success";
    },
  };
}

/**
 * The agent's wallet, keeping what it would send. `estimateError` makes every estimate fail; `sendError`, every
 * send, after the node took it (kept in `sent`).
 */
function fakeSigner({ estimateError, sendError }: { estimateError?: Error; sendError?: Error } = {}) {
  const sent: AgentTransaction[] = [];
  const signer: AgentSigner = {
    address: AGENT,
    estimate: async () => {
      if (estimateError) throw estimateError;
      return { gas: 200_000n, maxFeePerGas: 100_000_000_000n, maxCost: 200_000n * 100_000_000_000n };
    },
    send: async (tx) => {
      sent.push(tx);
      if (sendError) throw sendError;
      return HASH;
    },
  };
  return { signer, sent };
}

function context(chain: ChainView, signer: AgentSigner, send = true): AgentContext {
  return { chain, signer, now: () => NOW, send };
}

const SECOND_FUND = getAddress("0x00000000000000000000000000000000000f00d2");

describe("runHeartbeat", () => {
  it("converts the USDT waiting in a fund, near the quote", async () => {
    const { signer, sent } = fakeSigner();
    const fund = fundSnapshot({ dollarBalance: 300n * USDT_UNIT });
    const decisions = await runHeartbeat(context(fakeChain([fund]), signer));
    const minCurrencyOut = (QUOTE.quotedCurrency * 9_950n) / 10_000n;
    expect(decisions).toEqual([
      {
        fund: FUND,
        kind: "convert",
        reason: "Convert 300 USDT to at least 479832 wARS",
        action: { kind: "convert", dollarAmount: 300n * USDT_UNIT, minCurrencyOut },
        tx: HASH,
        status: "success",
      },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(FUND);
    expect(decodeFunctionData({ abi: fundAbi, data: sent[0]?.data ?? "0x" })).toEqual({
      functionName: "convert",
      args: [300n * USDT_UNIT, minCurrencyOut],
    });
  });

  it("converts a v2 fund's pending dollars in one transaction", async () => {
    const { signer, sent } = fakeSigner();
    const [ana, beto] = MEMBERS as [Address, Address, Address];
    // 100 + 200 USDT pending (and 50 more sent straight to the fund, which is nobody's and stays put).
    const fund = fundSnapshotWithPending([100n * USDT_UNIT, 200n * USDT_UNIT, 0n], { dollarBalance: 350n * USDT_UNIT });
    const quoted: [FundSnapshot, bigint][] = [];
    const chain: ChainView = { ...fakeChain([fund]), quote: async (f, dollarAmount) => (quoted.push([f, dollarAmount]), { ...QUOTE, dollarAmount }) };
    const decisions = await runHeartbeat(context(chain, signer));
    const minCurrencyOut = (QUOTE.quotedCurrency * 9_950n) / 10_000n;
    const action = {
      kind: "convert",
      dollarAmount: 300n * USDT_UNIT,
      minCurrencyOut,
      members: [ana, beto],
      amounts: [100n * USDT_UNIT, 200n * USDT_UNIT],
    };
    expect(decisions).toEqual([
      { fund: FUND, kind: "convert", reason: "Convert 300 USDT to at least 479832 wARS", action, tx: HASH, status: "success" },
    ]);
    expect(quoted).toEqual([[fund, 300n * USDT_UNIT]]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(FUND);
    expect(decodeFunctionData({ abi: fundV2Abi, data: sent[0]?.data ?? "0x" })).toEqual({
      functionName: "convert",
      args: [[ana, beto], [100n * USDT_UNIT, 200n * USDT_UNIT], minCurrencyOut],
    });
  });

  it("leaves a v2 fund's dollars alone unless members have them pending", async () => {
    const { signer, sent } = fakeSigner();
    const funds = [
      // Dollars sent straight to the fund, however many, belong to nobody.
      fundSnapshotV2({ dollarBalance: 300n * USDT_UNIT }),
      fundSnapshotWithPending([2n * USDT_UNIT, 2n * USDT_UNIT, 0n], { address: SECOND_FUND }),
    ];
    const historiesRead: Address[] = [];
    const chain = fakeChain(funds);
    const watched: ChainView = { ...chain, events: async (fund, toBlock) => (historiesRead.push(fund), chain.events(fund, toBlock)) };
    expect(await runHeartbeat(context(watched, signer))).toEqual([]);
    expect(sent).toEqual([]);
    expect(historiesRead).toEqual([]);
  });

  it("keeps a v2 fund's skips and limits: what a day leaves under 5 USDT is a daily-limit skip", async () => {
    const { signer, sent } = fakeSigner();
    const events = [converted(998n * USDT_UNIT, BLOCK - 10n, 8)];
    const chain = fakeChain([fundSnapshotWithPending([100n * USDT_UNIT, 100n * USDT_UNIT, 0n])], { events });
    expect(await runHeartbeat(context(chain, signer))).toEqual([
      { fund: FUND, kind: "skip", code: "daily-limit", reason: "The agent reached its daily conversion limit for this fund" },
    ]);
    expect(sent).toEqual([]);
  });

  it("reads each currency's references once per heartbeat, for the funds that use it", async () => {
    const { signer, sent } = fakeSigner();
    const funds = [fundSnapshot({ dollarBalance: 300n * USDT_UNIT }), fundSnapshotWithPending([300n * USDT_UNIT, 0n, 0n], { address: SECOND_FUND })];
    const asked: Currency[] = [];
    const chain: ChainView = { ...fakeChain(funds), references: async (currency) => (asked.push(currency), REFERENCES) };
    const decisions = await runHeartbeat(context(chain, signer));
    expect(decisions.map((d) => d.kind)).toEqual(["convert", "convert"]);
    expect(asked).toEqual([WARS_CURRENCY]);
    expect(sent).toHaveLength(2);
  });

  it("leaves alone funds with less than 5 USDT, closed funds and other agents' funds", async () => {
    const { signer, sent } = fakeSigner();
    const funds = [
      fundSnapshot({ dollarBalance: 4n * USDT_UNIT }),
      fundSnapshot({ address: SECOND_FUND, dollarBalance: 300n * USDT_UNIT, closed: true }),
      fundSnapshot({ address: OUTSIDER, dollarBalance: 300n * USDT_UNIT, agent: OUTSIDER }),
    ];
    const historiesRead: Address[] = [];
    const chain = fakeChain(funds);
    const watched: ChainView = { ...chain, events: async (fund, toBlock) => (historiesRead.push(fund), chain.events(fund, toBlock)) };
    expect(await runHeartbeat(context(watched, signer))).toEqual([]);
    expect(sent).toEqual([]);
    // Anyone can create a fund that names this agent: those it leaves alone cost no history read.
    expect(historiesRead).toEqual([]);
  });

  it("pays a v2 fund's fee once a week, from week 1", async () => {
    const owing = fundSnapshotV2({ feeOwed: 40n * WARS_UNIT });
    const { signer, sent } = fakeSigner();
    expect(await runHeartbeat(context(fakeChain([owing]), signer))).toEqual([
      { fund: FUND, kind: "pay-fee", reason: "Send the fund's fee: 40 wARS", action: { kind: "pay-fee" }, tx: HASH, status: "success" },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(FUND);
    expect(decodeFunctionData({ abi: fundV2Abi, data: sent[0]?.data ?? "0x" })).toMatchObject({ functionName: "payFee" });

    // The fee of last week's last block doesn't make this week's: the week's first block is the week's.
    const start = weekStartBlock(owing);
    for (const [block, pays] of [[start - 1n, true], [start, false], [BLOCK - 10n, false]] as const) {
      const { signer: again, sent: out } = fakeSigner();
      const decisions = await runHeartbeat(context(fakeChain([owing], { events: [feePaid(30n * WARS_UNIT, block, 9)] }), again));
      expect(decisions.map((d) => d.kind), `a fee in block ${block}`).toEqual(pays ? ["pay-fee"] : []);
      expect(out).toHaveLength(pays ? 1 : 0);
    }

    // Nothing in week 0, nothing when nothing is owed, nothing for another agent's fund or one the agent doesn't serve.
    const week0 = { ...owing, week: 0n, timestamp: owing.startTime + 3_600n };
    const others = [week0, fundSnapshotV2({ feeOwed: 0n }), fundSnapshotV2({ feeOwed: 40n * WARS_UNIT, agent: OUTSIDER }), fundSnapshotV2({ feeOwed: 40n * WARS_UNIT, pool: OUTSIDER })];
    for (const fund of others) {
      const { signer: quiet, sent: none } = fakeSigner();
      expect(await runHeartbeat(context(fakeChain([fund]), quiet))).toEqual([]);
      expect(none).toEqual([]);
    }
    // A v1 fund has no fee to send.
    const v1 = fakeSigner();
    expect(await runHeartbeat(context(fakeChain([fundSnapshot()]), v1.signer))).toEqual([]);
  });

  it("pays the fee even with nothing to convert", async () => {
    const { signer, sent } = fakeSigner();
    // A fund with no dollar at all, in wMXN: there's nothing to convert, ever.
    const fund = fundSnapshotWithoutDollar("wMXN", { feeOwed: 4n * WARS_UNIT });
    const decisions = await runHeartbeat(context(fakeChain([fund]), signer));
    expect(decisions).toMatchObject([{ fund: FUND, kind: "pay-fee", reason: "Send the fund's fee: 4 wMXN", tx: HASH, status: "success" }]);
    expect(sent).toHaveLength(1);
  });

  it("pays the fee and then converts, reading the history once", async () => {
    const { signer, sent } = fakeSigner();
    const fund = fundSnapshotWithPending([300n * USDT_UNIT, 0n, 0n], { feeOwed: 40n * WARS_UNIT });
    const chain = fakeChain([fund]);
    const historiesRead: Address[] = [];
    const watched: ChainView = { ...chain, events: async (address, toBlock) => (historiesRead.push(address), chain.events(address, toBlock)) };
    expect((await runHeartbeat(context(watched, signer))).map((d) => d.kind)).toEqual(["pay-fee", "convert"]);
    expect(sent.map((tx) => decodeFunctionData({ abi: fundV2Abi, data: tx.data }).functionName)).toEqual(["payFee", "convert"]);
    expect(historiesRead).toEqual([FUND]);
  });

  it("counts the fee it just sent among the day's transactions before it converts", async () => {
    const { signer, sent } = fakeSigner();
    const fund = fundSnapshotWithPending([300n * USDT_UNIT, 0n, 0n], { feeOwed: 40n * WARS_UNIT });
    // The 19th of the day's 20: the fee takes it, and the conversion has none left.
    const events = Array.from({ length: 19 }, (_, i) => proposed(AGENT, BLOCK - 100n, 100 + i));
    const decisions = await runHeartbeat(context(fakeChain([fund], { events }), signer));
    expect(decisions.map((d) => d.kind)).toEqual(["pay-fee", "blocked"]);
    expect(decisions[1]?.reason).toBe("The agent already sent 20 transactions for this fund in the last day");
    expect(sent).toHaveLength(1);
  });

  it("pays the last fee of a closed v2 fund, and doesn't go on to convert", async () => {
    const { signer, sent } = fakeSigner();
    // Closed, with dollars a member still has pending: the fee is owed, the conversion isn't done.
    const fund = fundSnapshotWithPending([300n * USDT_UNIT, 0n, 0n], { closed: true, feeOwed: 40n * WARS_UNIT });
    const quotes: bigint[] = [];
    const chain: ChainView = { ...fakeChain([fund]), quote: async (_fund, dollarAmount) => (quotes.push(dollarAmount), { ...QUOTE, dollarAmount }) };
    const decisions = await runHeartbeat(context(chain, signer));
    expect(decisions).toEqual([
      { fund: FUND, kind: "pay-fee", reason: "Send the fund's fee: 40 wARS", action: { kind: "pay-fee" }, tx: HASH, status: "success" },
    ]);
    expect(sent).toHaveLength(1);
    expect(quotes).toEqual([]);
    // Once it's paid there's nothing left to do for it, and its history isn't read.
    const historiesRead: Address[] = [];
    const paid = fakeChain([{ ...fund, feeOwed: 0n }]);
    const watched: ChainView = { ...paid, events: async (address, toBlock) => (historiesRead.push(address), paid.events(address, toBlock)) };
    expect(await runHeartbeat(context(watched, signer))).toEqual([]);
    expect(historiesRead).toEqual([]);
  });

  it("returns one blocked entry when the factory's funds can't be listed", async () => {
    const { signer, sent } = fakeSigner();
    const chain: ChainView = {
      ...fakeChain([]),
      funds: async () => {
        throw new Error("RPC down");
      },
    };
    expect(await runHeartbeat(context(chain, signer))).toEqual([{ kind: "blocked", reason: "Could not list the funds: RPC down" }]);
    expect(sent).toEqual([]);
  });

  it("hands over each hash as soon as it is sent, before the receipt", async () => {
    const { signer } = fakeSigner();
    const handed: unknown[] = [];
    const chain = fakeChain([fundSnapshot({ dollarBalance: 300n * USDT_UNIT })], { receiptError: new Error("timed out") });
    const ctx: AgentContext = { ...context(chain, signer), onSent: async (sent) => void handed.push(sent) };
    const [decision] = await runHeartbeat(ctx);
    expect(handed).toEqual([{ fund: FUND, action: decision?.action, tx: HASH }]);
    // A failing hook doesn't turn a sent transaction into a blocked one.
    const failing: AgentContext = {
      ...context(chain, signer),
      onSent: async () => {
        throw new Error("database down");
      },
    };
    const [still] = await runHeartbeat(failing);
    expect(still).toMatchObject({ kind: "convert", tx: HASH });
  });

  it("says in the reason when the hash couldn't be recorded, and still reads the receipt", async () => {
    const { signer, sent } = fakeSigner();
    const chain = fakeChain([fundSnapshot({ dollarBalance: 300n * USDT_UNIT })]);
    const ctx: AgentContext = {
      ...context(chain, signer),
      onSent: async () => {
        throw new Error("database down");
      },
    };
    const [decision] = await runHeartbeat(ctx);
    expect(decision).toMatchObject({
      kind: "convert",
      tx: HASH,
      status: "success",
      reason: expect.stringContaining("(hash not recorded: database down)"),
    });
    expect(sent).toHaveLength(1);
  });

  it("logs why it waits when Chainlink is stale, and sends nothing", async () => {
    const { signer, sent } = fakeSigner();
    const stale = { ...REFERENCES, currencyUsd: { ...REFERENCES.currencyUsd, updatedAt: NOW - 30n * 3_600n } };
    const chain = fakeChain([fundSnapshot({ dollarBalance: 300n * USDT_UNIT })], { references: stale });
    expect(await runHeartbeat(context(chain, signer))).toEqual([
      { fund: FUND, kind: "skip", code: "price-reference", reason: "Chainlink's USD / ARS is 30.0 hours old (26 at most)" },
    ]);
    expect(sent).toEqual([]);
  });

  it("on a dry run, decides and estimates but sends nothing", async () => {
    const { signer, sent } = fakeSigner();
    const chain = fakeChain([fundSnapshot({ dollarBalance: 300n * USDT_UNIT })]);
    const [decision] = await runHeartbeat(context(chain, signer, false));
    expect(decision).toMatchObject({ kind: "convert", reason: expect.stringContaining("(dry run: not sent)") });
    expect(decision?.tx).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it("reads each fund as the version the list of factories gave it", async () => {
    const { signer } = fakeSigner();
    const base = fakeChain([fundSnapshot({ agent: OUTSIDER }), fundSnapshotV2({ address: SECOND_FUND, agent: OUTSIDER })]);
    const read: FundRef[] = [];
    const chain: ChainView = {
      ...base,
      fund: async (fund) => {
        read.push(fund);
        return base.fund(fund);
      },
    };
    expect(await runHeartbeat(context(chain, signer))).toEqual([]);
    expect(read).toEqual([
      { address: FUND, version: 1 },
      { address: SECOND_FUND, version: 2 },
    ]);
  });

  it("leaves a v2 fund it doesn't serve alone in the heartbeat", async () => {
    const { signer, sent } = fakeSigner();
    // The same fund as a served one, except for a balance cap above the table's: with its USDT waiting, it would be converted.
    const fund = fundSnapshotV2({ dollarBalance: 300n * USDT_UNIT, balanceCap: 450_000n * WARS_UNIT + 1n });
    expect(servedProblem(fund)).not.toBeNull();
    const historiesRead: Address[] = [];
    const chain = fakeChain([fund]);
    const watched: ChainView = { ...chain, events: async (address, toBlock) => (historiesRead.push(address), chain.events(address, toBlock)) };
    expect(await runHeartbeat(context(watched, signer))).toEqual([]);
    expect(sent).toEqual([]);
    expect(historiesRead).toEqual([]);
  });

  it("goes on with the next fund when one can't be read", async () => {
    const { signer, sent } = fakeSigner();
    const funds = [fundSnapshot({ dollarBalance: 300n * USDT_UNIT }), fundSnapshot({ address: SECOND_FUND, dollarBalance: 300n * USDT_UNIT })];
    const decisions = await runHeartbeat(context(fakeChain(funds, { failing: [FUND] }), signer));
    expect(decisions.map((d) => [d.fund, d.kind])).toEqual([
      [FUND, "blocked"],
      [SECOND_FUND, "convert"],
    ]);
    expect(decisions[0]?.reason).toBe("Could not run the fund: RPC down");
    expect(sent).toHaveLength(1);
  });

  it("keeps the hash of a sent transaction whose receipt it couldn't read", async () => {
    const { signer, sent } = fakeSigner();
    const chain = fakeChain([fundSnapshot({ dollarBalance: 300n * USDT_UNIT })], { receiptError: new Error("timed out") });
    const [decision] = await runHeartbeat(context(chain, signer));
    expect(decision).toMatchObject({
      kind: "convert",
      tx: HASH,
      reason: expect.stringContaining("(sent; receipt unknown: timed out)"),
    });
    expect(decision?.status).toBeUndefined();
    expect(sent).toHaveLength(1);
  });

  it("sends nothing when the agent is short of gas or the transaction would fail", async () => {
    const fund = fundSnapshot({ dollarBalance: 300n * USDT_UNIT });
    const poor = fakeSigner();
    const [lowGas] = await runHeartbeat(context(fakeChain([fund], { gas: MIN_GAS_USDT - 1n }), poor.signer));
    expect(lowGas).toMatchObject({ kind: "blocked", reason: "The agent holds 0.049999 USDT for gas, under 0.05" });
    const failing = fakeSigner({ estimateError: new Error("execution reverted: MinOutTooLow") });
    const [reverts] = await runHeartbeat(context(fakeChain([fund]), failing.signer));
    expect(reverts).toMatchObject({ kind: "blocked", reason: "The transaction would fail: execution reverted: MinOutTooLow" });
    expect([...poor.sent, ...failing.sent]).toEqual([]);
  });
});

describe("handleExpense", () => {
  const PITCH: Expense = { member: MEMBER, amount: 45_000n * WARS_UNIT, kind: "agreed", ref: ref(7), note: "Cancha", enteredAt: NOW - 60n };

  it("pays the agreed expense back", async () => {
    const { signer, sent } = fakeSigner();
    const decision = await handleExpense(context(fakeChain([fundSnapshot()]), signer), FUND, PITCH);
    expect(decision).toMatchObject({ kind: "reimburse", reason: "Pay back 45000 wARS of the agreed expense", tx: HASH });
    expect(decodeFunctionData({ abi: fundAbi, data: sent[0]?.data ?? "0x" })).toEqual({
      functionName: "reimburseAgreedExpense",
      args: [MEMBER, 45_000n * WARS_UNIT, ref(7)],
    });
  });

  it("blocks an expense of a v2 fund it doesn't serve, saying why", async () => {
    const { signer, sent } = fakeSigner();
    const fund = fundSnapshotV2({ pool: OUTSIDER });
    const problem = servedProblem(fund);
    expect(problem).toMatch(/dollar and pool/);
    // Blocked, never rejected: a rejection is terminal, and the fund may be served once the table says so.
    expect(await handleExpense(context(fakeChain([fund]), signer), FUND, PITCH)).toEqual({ fund: FUND, kind: "blocked", reason: problem });
    expect(sent).toEqual([]);
  });

  it("says the fund's currency", async () => {
    const { signer, sent } = fakeSigner();
    const fund = fundSnapshotWithoutDollar("wMXN");
    const pitch: Expense = { ...PITCH, amount: 1_100n * WARS_UNIT };
    const decision = await handleExpense(context(fakeChain([fund]), signer), FUND, pitch);
    expect(decision).toMatchObject({ kind: "reimburse", reason: "Pay back 1100 wMXN of the agreed expense", tx: HASH });
    expect(decodeFunctionData({ abi: fundAbi, data: sent[0]?.data ?? "0x" })).toEqual({
      functionName: "reimburseAgreedExpense",
      args: [MEMBER, 1_100n * WARS_UNIT, ref(7)],
    });
  });

  it("proposes what doesn't fit in the week's cap", async () => {
    const { signer, sent } = fakeSigner();
    const chain = fakeChain([fundSnapshot({ spentThisWeek: 50_000n * WARS_UNIT })]);
    const decision = await handleExpense(context(chain, signer), FUND, PITCH);
    expect(decision).toMatchObject({ kind: "propose-payment", tx: HASH });
    expect(decodeFunctionData({ abi: fundAbi, data: sent[0]?.data ?? "0x" })).toMatchObject({
      functionName: "propose",
      args: [0, MEMBER, expect.any(String), 45_000n * WARS_UNIT, "Cancha"],
    });
  });

  it("takes a payment it already proposed for this expense as proposed, with that transaction, and sends nothing", async () => {
    const { signer, sent } = fakeSigner();
    const earlier = proposed(AGENT, BLOCK - 30n, 42, { a: MEMBER, amount: PITCH.amount, note: "Pelotas" });
    const chain = fakeChain([fundSnapshot()], { events: [earlier] });
    expect(await handleExpense(context(chain, signer), FUND, { ...PITCH, kind: "other", note: "Pelotas" })).toEqual({
      fund: FUND,
      kind: "propose-payment",
      reason: `Already proposed, in transaction ${earlier.transactionHash}`,
      tx: earlier.transactionHash,
      status: "success",
    });
    expect(sent).toEqual([]);
  });

  it("proposes a give-back in a v2 fund as a GiveBack, for the members to vote on", async () => {
    const { signer, sent } = fakeSigner();
    const giveBack: Expense = { ...PITCH, kind: "give-back", amount: 10_000n * WARS_UNIT, note: "Deposité en otro fondo" };
    const decision = await handleExpense(context(fakeChain([fundSnapshotV2()]), signer), FUND, giveBack);
    expect(decision).toEqual({
      fund: FUND,
      kind: "propose-give-back",
      reason: "A contribution given back is always voted on",
      action: { kind: "propose-give-back", member: MEMBER, amount: 10_000n * WARS_UNIT, note: "Deposité en otro fondo" },
      tx: HASH,
      status: "success",
    });
    expect(decodeFunctionData({ abi: fundV2Abi, data: sent[0]?.data ?? "0x" })).toEqual({
      functionName: "propose",
      args: [8, MEMBER, zeroAddress, 10_000n * WARS_UNIT, "Deposité en otro fondo"],
    });
  });

  it("takes a GiveBack it already proposed as proposed, in that transaction, and sends nothing", async () => {
    const { signer, sent } = fakeSigner();
    const giveBack: Expense = { ...PITCH, kind: "give-back", amount: 10_000n * WARS_UNIT, note: "Deposité" };
    // It took the agent's last place of the week: the proposal that went out is not a "quota".
    const earlier = proposed(AGENT, BLOCK - 30n, 42, { action: 8, a: MEMBER, amount: giveBack.amount, note: "Deposité" });
    const chain = fakeChain([fundSnapshotV2({ agentProposalsThisWeek: 10n })], { events: [earlier] });
    expect(await handleExpense(context(chain, signer), FUND, giveBack)).toEqual({
      fund: FUND,
      kind: "propose-give-back",
      reason: `Already proposed, in transaction ${earlier.transactionHash}`,
      tx: earlier.transactionHash,
      status: "success",
    });
    expect(sent).toEqual([]);
  });

  it("waits, with the quota's code, when the agent has no proposals left for this member this week", async () => {
    const { signer, sent } = fakeSigner();
    const chain = fakeChain([fundSnapshotV2({ agentProposalsThisWeek: 10n })]);
    const decision = await handleExpense(context(chain, signer), FUND, { ...PITCH, kind: "other", note: "Pelotas" });
    expect(decision).toEqual({ fund: FUND, kind: "wait", code: "proposal-quota", reason: expect.stringContaining("proposals for this week") });
    // An agreed expense that fits is paid back all the same.
    expect(await handleExpense(context(chain, signer), FUND, PITCH)).toMatchObject({ kind: "reimburse", tx: HASH });
    expect(sent).toHaveLength(1);
    // A wait that has no code carries none.
    const short = await handleExpense(context(fakeChain([fundSnapshot({ currencyBalance: 0n })]), signer), FUND, PITCH);
    expect(short).toEqual({ fund: FUND, kind: "wait", reason: "The fund doesn't hold enough wARS yet" });
  });

  it("says a send that threw may have reached the node: the transaction may be out, so it's never a plain block", async () => {
    const { signer, sent } = fakeSigner({ sendError: new Error("nonce too low") });
    const decision = await handleExpense(context(fakeChain([fundSnapshot()]), signer), FUND, PITCH);
    expect(decision).toEqual({
      fund: FUND,
      kind: "blocked",
      reason: "Could not send the transaction: nonce too low",
      action: { kind: "reimburse", member: MEMBER, amount: PITCH.amount, ref: PITCH.ref },
      sendFailed: true,
    });
    expect(sent).toHaveLength(1);
    // A block before anything was sent is just that.
    const refused = fakeSigner({ estimateError: new Error("execution reverted") });
    const before = await handleExpense(context(fakeChain([fundSnapshot()]), refused.signer), FUND, PITCH);
    expect(before).toMatchObject({ kind: "blocked" });
    expect(before).not.toHaveProperty("sendFailed");
  });

  it("rejects a fund no factory created, without reading it", async () => {
    const { signer, sent } = fakeSigner();
    const chain = fakeChain([fundSnapshot()]);
    expect(await handleExpense(context(chain, signer), SECOND_FUND, PITCH)).toEqual({
      fund: SECOND_FUND,
      kind: "reject",
      reason: "That fund wasn't created by TesorerIA's FundFactory",
    });
    expect(sent).toEqual([]);
  });

  it("reads the fund as the version the list of factories gave it, from the address it was handed", async () => {
    const { signer } = fakeSigner();
    const base = fakeChain([fundSnapshot(), fundSnapshotV2({ address: SECOND_FUND, agent: OUTSIDER })]);
    const read: FundRef[] = [];
    const chain: ChainView = {
      ...base,
      fund: async (fund) => {
        read.push(fund);
        return base.fund(fund);
      },
    };
    expect(await handleExpense(context(chain, signer), SECOND_FUND, PITCH)).toEqual({
      fund: SECOND_FUND,
      kind: "reject",
      reason: "This agent doesn't run that fund",
    });
    expect(read).toEqual([{ address: SECOND_FUND, version: 2 }]);
  });

  it("sends nothing for an expense already paid back, or a fund another agent runs", async () => {
    const { signer, sent } = fakeSigner();
    const paid = fakeChain([fundSnapshot()], { events: [reimbursed(MEMBER, PITCH.amount, PITCH.ref)] });
    expect(await handleExpense(context(paid, signer), FUND, PITCH)).toMatchObject({ kind: "reject" });
    const theirs = fakeChain([fundSnapshot({ agent: OUTSIDER })]);
    expect(await handleExpense(context(theirs, signer), FUND, PITCH)).toEqual({
      fund: FUND,
      kind: "reject",
      reason: "This agent doesn't run that fund",
    });
    expect(sent).toEqual([]);
  });
});

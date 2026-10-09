import { type Address, type Hash, decodeFunctionData, getAddress, pad } from "viem";
import { describe, expect, it } from "vitest";
import { fundAbi } from "../src/abi";
import type { FundEvent } from "../src/events";
import type { Expense } from "../src/expense";
import type { FundSnapshot } from "../src/fund";
import type { ConversionQuote, References } from "../src/market";
import { type AgentContext, type ChainView, MIN_GAS_USDT, handleExpense, runHeartbeat } from "../src/run";
import type { AgentSigner, AgentTransaction } from "../src/signer";
import { AGENT, FUND, MEMBERS, OUTSIDER, USDT_UNIT, WARS_UNIT, fundSnapshot, ref, reimbursed } from "./support/fixtures";

const NOW = 1_791_561_510n;
const HASH: Hash = pad("0x7a", { size: 32 });
const REFERENCES: References = {
  usdArs: { answer: 160_790_320_000n, decimals: 8, updatedAt: 1_791_555_995n },
  usdtUsd: { answer: 99_913_512n, decimals: 8, updatedAt: 1_791_561_336n },
};
const QUOTE: ConversionQuote = {
  usdtAmount: 300n * USDT_UNIT,
  quotedWars: 482_243_292_884_944_290_611_892n,
  twapWars: 482_300_000_000_000_000_000_000n,
  poolWars: 106_669_036_955_606_543_270_134_078n,
};
const MEMBER = MEMBERS[1] as Address;

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
    funds: async () => funds.map((f) => f.address),
    fund: async (address) => {
      if (failing.includes(address)) throw new Error("RPC down");
      const fund = funds.find((f) => f.address === address);
      if (fund === undefined) throw new Error(`no fund ${address}`);
      return fund;
    },
    events: async () => events,
    references: async () => references,
    quote: async (_fund, usdtAmount) => ({ ...QUOTE, usdtAmount }),
    receipt: async () => {
      if (receiptError) throw receiptError;
      return "success";
    },
  };
}

/** The agent's wallet, keeping what it would send. `estimateError` makes every estimate fail. */
function fakeSigner({ estimateError }: { estimateError?: Error } = {}) {
  const sent: AgentTransaction[] = [];
  const signer: AgentSigner = {
    address: AGENT,
    estimate: async () => {
      if (estimateError) throw estimateError;
      return { gas: 200_000n, maxFeePerGas: 100_000_000_000n, maxCost: 200_000n * 100_000_000_000n };
    },
    send: async (tx) => {
      sent.push(tx);
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
    const fund = fundSnapshot({ usdtBalance: 300n * USDT_UNIT });
    const decisions = await runHeartbeat(context(fakeChain([fund]), signer));
    const minWarsOut = (QUOTE.quotedWars * 9_950n) / 10_000n;
    expect(decisions).toEqual([
      {
        fund: FUND,
        kind: "convert",
        reason: "Convert 300 USDT to at least 479832 wARS",
        action: { kind: "convert", usdtAmount: 300n * USDT_UNIT, minWarsOut },
        tx: HASH,
        status: "success",
      },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(FUND);
    expect(decodeFunctionData({ abi: fundAbi, data: sent[0]?.data ?? "0x" })).toEqual({
      functionName: "convert",
      args: [300n * USDT_UNIT, minWarsOut],
    });
  });

  it("leaves alone funds with less than 5 USDT, closed funds and other agents' funds", async () => {
    const { signer, sent } = fakeSigner();
    const funds = [
      fundSnapshot({ usdtBalance: 4n * USDT_UNIT }),
      fundSnapshot({ address: SECOND_FUND, usdtBalance: 300n * USDT_UNIT, closed: true }),
      fundSnapshot({ address: OUTSIDER, usdtBalance: 300n * USDT_UNIT, agent: OUTSIDER }),
    ];
    expect(await runHeartbeat(context(fakeChain(funds), signer))).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("logs why it waits when Chainlink is stale, and sends nothing", async () => {
    const { signer, sent } = fakeSigner();
    const stale = { ...REFERENCES, usdArs: { ...REFERENCES.usdArs, updatedAt: NOW - 30n * 3_600n } };
    const chain = fakeChain([fundSnapshot({ usdtBalance: 300n * USDT_UNIT })], { references: stale });
    expect(await runHeartbeat(context(chain, signer))).toEqual([
      { fund: FUND, kind: "skip", reason: "Chainlink's USD / ARS is 30.0 hours old (26 at most)" },
    ]);
    expect(sent).toEqual([]);
  });

  it("on a dry run, decides and estimates but sends nothing", async () => {
    const { signer, sent } = fakeSigner();
    const chain = fakeChain([fundSnapshot({ usdtBalance: 300n * USDT_UNIT })]);
    const [decision] = await runHeartbeat(context(chain, signer, false));
    expect(decision).toMatchObject({ kind: "convert", reason: expect.stringContaining("(dry run: not sent)") });
    expect(decision?.tx).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it("goes on with the next fund when one can't be read", async () => {
    const { signer, sent } = fakeSigner();
    const funds = [fundSnapshot({ usdtBalance: 300n * USDT_UNIT }), fundSnapshot({ address: SECOND_FUND, usdtBalance: 300n * USDT_UNIT })];
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
    const chain = fakeChain([fundSnapshot({ usdtBalance: 300n * USDT_UNIT })], { receiptError: new Error("timed out") });
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
    const fund = fundSnapshot({ usdtBalance: 300n * USDT_UNIT });
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
  const PITCH: Expense = { member: MEMBER, amount: 45_000n * WARS_UNIT, kind: "agreed", ref: ref(7), note: "Cancha" };

  it("pays the agreed expense back", async () => {
    const { signer, sent } = fakeSigner();
    const decision = await handleExpense(context(fakeChain([fundSnapshot()]), signer), FUND, PITCH);
    expect(decision).toMatchObject({ kind: "reimburse", reason: "Pay back 45000 wARS of the agreed expense", tx: HASH });
    expect(decodeFunctionData({ abi: fundAbi, data: sent[0]?.data ?? "0x" })).toEqual({
      functionName: "reimburseAgreedExpense",
      args: [MEMBER, 45_000n * WARS_UNIT, ref(7)],
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

  it("rejects a fund the factory didn't create, without reading it", async () => {
    const { signer, sent } = fakeSigner();
    const chain = fakeChain([fundSnapshot()]);
    expect(await handleExpense(context(chain, signer), SECOND_FUND, PITCH)).toEqual({
      fund: SECOND_FUND,
      kind: "reject",
      reason: "That fund wasn't created by TesorerIA's FundFactory",
    });
    expect(sent).toEqual([]);
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

import { type Address, type Hash, type Hex, getAddress, pad, toHex } from "viem";
import type { FundEvent } from "../../src/events";
import { POOL, USDT, WARS } from "../../src/chain";
import { CURRENCIES, type Currency } from "../../src/currencies";
import { type FundSnapshot, WEEK } from "../../src/fund";

export const WARS_UNIT = 10n ** 18n;
export const USDT_UNIT = 10n ** 6n;
export const AGENT = getAddress("0x00000000000000000000000000000000000a6e17");
export const FUND = getAddress("0x00000000000000000000000000000000000f00d1");
export const MEMBERS: readonly Address[] = [
  getAddress("0x000000000000000000000000000000000000aaa1"),
  getAddress("0x000000000000000000000000000000000000aaa2"),
  getAddress("0x000000000000000000000000000000000000aaa3"),
];
export const OUTSIDER = getAddress("0x0000000000000000000000000000000000000bad");
export const BLOCK = 80_000_000n;

const START_TIME = 1_791_000_000n;

/** A version 1 fund of three that each put in 30,000 wARS, in week 2, with nothing spent yet; one thing changed per test. */
export function fundSnapshot(change: Partial<FundSnapshot> = {}): FundSnapshot {
  return {
    address: FUND,
    version: 1,
    block: BLOCK,
    timestamp: START_TIME + 2n * WEEK + 3_600n,
    agent: AGENT,
    closed: false,
    members: MEMBERS,
    contributed: [30_000n * WARS_UNIT, 30_000n * WARS_UNIT, 30_000n * WARS_UNIT],
    totalContributed: 90_000n * WARS_UNIT,
    proposalCount: 0n,
    votesRequired: 2,
    weeklyCap: 60_000n * WARS_UNIT,
    startTime: START_TIME,
    week: 2n,
    spentThisWeek: 0n,
    currency: WARS,
    dollar: USDT,
    pool: POOL,
    feeBps: 0,
    feeOwed: 0n,
    balanceCap: 450_000n * WARS_UNIT,
    currencyBalance: 90_000n * WARS_UNIT,
    dollarBalance: 0n,
    pendingDollar: [0n, 0n, 0n],
    pendingValue: [0n, 0n, 0n],
    totalPendingDollar: 0n,
    agentProposalsThisWeek: 0n,
    ...change,
  };
}

/** The same fund as version 2 (wARS with USDT) with its fee of 0.25%, nothing owed and nothing pending; one thing changed per test. */
export function fundSnapshotV2(change: Partial<FundSnapshot> = {}): FundSnapshot {
  return fundSnapshot({ version: 2, feeBps: 25, ...change });
}

/**
 * The version 2 fund of `fundSnapshotV2` where each member (in the order of `MEMBERS`) has the given dollars pending:
 * the fund holds them as its dollar balance too, as the contract does. Dollars sent straight to the fund go in
 * `change.dollarBalance`, over that.
 */
export function fundSnapshotWithPending(pending: readonly bigint[], change: Partial<FundSnapshot> = {}): FundSnapshot {
  const total = pending.reduce((sum, amount) => sum + amount, 0n);
  return fundSnapshotV2({
    pendingDollar: pending,
    pendingValue: pending.map(() => 0n),
    totalPendingDollar: total,
    dollarBalance: total,
    ...change,
  });
}

/**
 * A version 2 fund in one of the table's currencies, with no dollar and that currency's balance cap (the table has a
 * dollar for wARS only, and a fund may go without one); the balances are the wARS fund's, as plain numbers. One thing
 * changed per test.
 */
export function fundSnapshotWithoutDollar(symbol: Currency["symbol"], change: Partial<FundSnapshot> = {}): FundSnapshot {
  const currency = CURRENCIES.find((c) => c.symbol === symbol);
  if (currency === undefined) throw new Error(`No ${symbol} in the table`);
  return fundSnapshotV2({
    currency: currency.token,
    dollar: null,
    pool: null,
    balanceCap: currency.limits.balanceCap,
    ...change,
  });
}

export function ref(n: number): Hex {
  return pad(toHex(n), { size: 32 });
}

function position(block: bigint, tx: number) {
  return { blockNumber: block, transactionHash: pad(toHex(tx), { size: 32 }) as Hash, logIndex: 0 };
}

export function reimbursed(member: Address, amount: bigint, refHex: Hex, block = BLOCK - 10n, tx = 1): FundEvent {
  return { eventName: "Reimbursement", args: { member, amount, ref: refHex, week: 2n }, ...position(block, tx) };
}

export function converted(dollarIn: bigint, block = BLOCK - 10n, tx = 2): FundEvent {
  return { eventName: "Conversion", args: { dollarIn, currencyOut: dollarIn * 1_600n * 10n ** 12n }, ...position(block, tx) };
}

export function proposed(
  proposer: Address,
  block = BLOCK - 10n,
  tx = 3,
  change: Partial<{ action: number; a: Address; amount: bigint; note: string }> = {},
): FundEvent {
  const member = MEMBERS[0] as Address;
  return {
    eventName: "ProposalCreated",
    args: { id: 0n, action: 0, a: member, b: OUTSIDER, amount: 1n, proposer, note: "", ...change },
    ...position(block, tx),
  };
}

export function feePaid(amount: bigint, block = BLOCK - 10n, tx = 6): FundEvent {
  return { eventName: "FeePaid", args: { amount }, ...position(block, tx) };
}

export function memberAdded(member: Address, block: bigint, tx = 4): FundEvent {
  return { eventName: "MemberAdded", args: { member }, ...position(block, tx) };
}

export function memberReplaced(oldMember: Address, newMember: Address, block: bigint, tx = 5): FundEvent {
  return { eventName: "MemberReplaced", args: { oldMember, newMember }, ...position(block, tx) };
}

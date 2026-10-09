import { type Address, type Hash, type Hex, getAddress, pad, toHex } from "viem";
import type { FundEvent } from "../../src/events";
import type { FundSnapshot } from "../../src/fund";

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

/** A fund of three that each put in 30,000 wARS, in week 2, with nothing spent yet; one thing changed per test. */
export function fundSnapshot(change: Partial<FundSnapshot> = {}): FundSnapshot {
  return {
    address: FUND,
    block: BLOCK,
    agent: AGENT,
    closed: false,
    members: MEMBERS,
    contributed: [30_000n * WARS_UNIT, 30_000n * WARS_UNIT, 30_000n * WARS_UNIT],
    totalContributed: 90_000n * WARS_UNIT,
    votesRequired: 2,
    weeklyCap: 60_000n * WARS_UNIT,
    startTime: 1_791_000_000n,
    week: 2n,
    spentThisWeek: 0n,
    warsBalance: 90_000n * WARS_UNIT,
    usdtBalance: 0n,
    ...change,
  };
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

export function converted(usdtIn: bigint, block = BLOCK - 10n, tx = 2): FundEvent {
  return { eventName: "Conversion", args: { usdtIn, warsOut: usdtIn * 1_600n * 10n ** 12n }, ...position(block, tx) };
}

export function proposed(proposer: Address, block = BLOCK - 10n, tx = 3): FundEvent {
  const member = MEMBERS[0] as Address;
  return {
    eventName: "ProposalCreated",
    args: { id: 0n, action: 0, a: member, b: OUTSIDER, amount: 1n, proposer, note: "" },
    ...position(block, tx),
  };
}

export function memberAdded(member: Address, block: bigint, tx = 4): FundEvent {
  return { eventName: "MemberAdded", args: { member }, ...position(block, tx) };
}

export function memberReplaced(oldMember: Address, newMember: Address, block: bigint, tx = 5): FundEvent {
  return { eventName: "MemberReplaced", args: { oldMember, newMember }, ...position(block, tx) };
}

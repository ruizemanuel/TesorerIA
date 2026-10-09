import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { type Expense, decideExpense } from "../src/expense";
import { LIMITS } from "../src/limits";
import { MEMBERS, OUTSIDER, WARS_UNIT, fundSnapshot, ref, reimbursed } from "./support/fixtures";

const MEMBER = MEMBERS[1] as Address;
const QUIET_DAY = { reimbursedWars: 0n, convertedUsdt: 0n, transactions: 0 };
const PITCH: Expense = { member: MEMBER, amount: 45_000n * WARS_UNIT, kind: "agreed", ref: ref(7), note: "Cancha del jueves" };

function decide(expense: Expense, change: Parameters<typeof fundSnapshot>[0] = {}, events = [] as ReturnType<typeof reimbursed>[], today = QUIET_DAY) {
  return decideExpense({ expense, fund: fundSnapshot(change), events, today });
}

describe("decideExpense", () => {
  it("pays the agreed expense back when it fits in the week's cap", () => {
    expect(decide(PITCH)).toEqual({ kind: "reimburse", member: MEMBER, amount: PITCH.amount, ref: PITCH.ref });
  });

  it("pays the member as the contract lists it, whatever the case of the address it got", () => {
    const decision = decide({ ...PITCH, member: MEMBER.toLowerCase() as Address });
    expect(decision).toMatchObject({ kind: "reimburse", member: MEMBER });
  });

  it("turns any other expense into a payment proposal", () => {
    expect(decide({ ...PITCH, kind: "other", note: "Pelotas nuevas" })).toEqual({
      kind: "propose-payment",
      member: MEMBER,
      amount: PITCH.amount,
      note: "Pelotas nuevas",
      reason: "Only the agreed expense is paid back without a vote",
    });
  });

  it("proposes what doesn't fit in what's left of the week's cap", () => {
    const decision = decide({ ...PITCH, amount: 20_000n * WARS_UNIT }, { spentThisWeek: 50_000n * WARS_UNIT });
    expect(decision).toMatchObject({
      kind: "propose-payment",
      reason: "It doesn't fit in what's left of this week's cap (10000 wARS)",
    });
  });

  it("proposes what's above the agent's own limits, even under the fund's cap", () => {
    const bigCap = { weeklyCap: 1_000_000n * WARS_UNIT, warsBalance: 1_000_000n * WARS_UNIT };
    const overOne = decide({ ...PITCH, amount: LIMITS.maxReimbursementWars + 1n }, bigCap);
    expect(overOne).toMatchObject({ kind: "propose-payment", reason: "It's above the agent's per-reimbursement limit" });
    const busy = { ...QUIET_DAY, reimbursedWars: LIMITS.maxDailyReimbursedWars - 1n };
    expect(decide(PITCH, bigCap, [], busy)).toMatchObject({
      kind: "propose-payment",
      reason: "It's above the agent's daily reimbursement limit",
    });
  });

  it("never pays the same expense back twice", () => {
    const earlier = reimbursed(MEMBER, PITCH.amount, PITCH.ref, 79_000_000n, 42);
    expect(decide(PITCH, {}, [earlier])).toEqual({
      kind: "reject",
      reason: `Already reimbursed, in transaction ${earlier.transactionHash}`,
    });
  });

  it("rejects someone who isn't a member, a zero amount and a closed fund", () => {
    expect(decide({ ...PITCH, member: OUTSIDER })).toEqual({ kind: "reject", reason: "Only members get money back" });
    expect(decide({ ...PITCH, amount: 0n })).toEqual({ kind: "reject", reason: "The amount must be more than zero" });
    expect(decide(PITCH, { closed: true })).toEqual({ kind: "reject", reason: "The fund is closed" });
  });

  it("waits when the fund doesn't hold enough wARS yet (its USDT may still be converting)", () => {
    expect(decide(PITCH, { warsBalance: 44_999n * WARS_UNIT })).toEqual({
      kind: "wait",
      reason: "The fund doesn't hold enough wARS yet",
    });
  });

  it("keeps the proposal's note to 140 characters", () => {
    const decision = decide({ ...PITCH, kind: "other", note: `  ${"á".repeat(200)}  ` });
    expect(decision).toMatchObject({ kind: "propose-payment", note: "á".repeat(140) });
  });
});

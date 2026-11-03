import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { type Expense, decideExpense } from "../src/expense";
import { LIMITS } from "../src/limits";
import type { FundEvent } from "../src/events";
import { AGENT, BLOCK, MEMBERS, OUTSIDER, WARS_UNIT, fundSnapshot, proposed, ref, reimbursed } from "./support/fixtures";

const MEMBER = MEMBERS[1] as Address;
const QUIET_DAY = { reimbursedWars: 0n, convertedUsdt: 0n, transactions: 0 };
const NOW = 1_791_561_510n;
/** Entered an hour ago: about 3,600 blocks before BLOCK, the snapshot's. */
const PITCH: Expense = { member: MEMBER, amount: 45_000n * WARS_UNIT, kind: "agreed", ref: ref(7), note: "Cancha del jueves", enteredAt: NOW - 3_600n };

function decide(expense: Expense, change: Parameters<typeof fundSnapshot>[0] = {}, events = [] as FundEvent[], today = QUIET_DAY) {
  return decideExpense({ expense, fund: fundSnapshot(change), events, today, now: NOW });
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

  it("takes a payment the agent already proposed for this expense as proposed: the contract keeps no ref for proposals", () => {
    const BALLS: Expense = { ...PITCH, kind: "other", note: "  Pelotas nuevas " };
    const ours = { a: MEMBER, amount: PITCH.amount, note: "Pelotas nuevas" };
    const earlier = proposed(AGENT, BLOCK - 600n, 42, ours); // ten minutes ago, after it was entered
    expect(decide(BALLS, {}, [earlier])).toEqual({
      kind: "proposed",
      transactionHash: earlier.transactionHash,
      reason: `Already proposed, in transaction ${earlier.transactionHash}`,
    });
    // The same holds for an agreed expense that didn't fit in the week's cap.
    const over = proposed(AGENT, BLOCK - 600n, 43, { ...ours, note: "Cancha del jueves" });
    expect(decide(PITCH, { spentThisWeek: 50_000n * WARS_UNIT }, [over])).toMatchObject({ kind: "proposed", transactionHash: over.transactionHash });

    // Anything else is another expense's, and this one is proposed.
    const others: Record<string, FundEvent> = {
      "another member": proposed(AGENT, BLOCK - 600n, 44, { ...ours, a: MEMBERS[0] as Address }),
      "another amount": proposed(AGENT, BLOCK - 600n, 45, { ...ours, amount: PITCH.amount + 1n }),
      "another note": proposed(AGENT, BLOCK - 600n, 46, { ...ours, note: "Pelotas" }),
      "a member's own proposal": proposed(MEMBERS[0] as Address, BLOCK - 600n, 47, ours),
      "another action": proposed(AGENT, BLOCK - 600n, 48, { ...ours, action: 4 }),
      "an earlier, identical expense's": proposed(AGENT, BLOCK - 3_600n - 301n, 49, ours),
    };
    for (const [why, event] of Object.entries(others)) expect(decide(BALLS, {}, [event]), why).toMatchObject({ kind: "propose-payment" });
    // Five minutes before it was entered still count, for clocks that don't agree.
    expect(decide(BALLS, {}, [proposed(AGENT, BLOCK - 3_600n - 300n, 50, ours)])).toMatchObject({ kind: "proposed" });
  });

  describe("an expense short of what the fund holds by less than half a centavo, what a screen in centavos can't show", () => {
    // The barbecue fund on 3/11: its screen said $ 50.013,31, a member entered that, and the fund held 50.013,3069…
    const HELD = 50_013_306_937_880_539_911_180n;
    const ALL: Expense = { ...PITCH, kind: "other", amount: 50_013_310_000_000_000_000_000n, note: "carne+bebida" };
    const WIDE = { weeklyCap: 1_000_000n * WARS_UNIT, warsBalance: HELD };

    it("proposes what the fund holds, so the proposal can be paid", () => {
      expect(decide(ALL, WIDE)).toMatchObject({ kind: "propose-payment", amount: HELD });
    });

    it("pays the agreed expense back with what the fund holds, instead of waiting", () => {
      const pitch = { ...PITCH, amount: 45_000n * WARS_UNIT };
      const held = pitch.amount - 3_062_119_460_088_820n;
      expect(decide(pitch, { warsBalance: held })).toEqual({ kind: "reimburse", member: MEMBER, amount: held, ref: PITCH.ref });
    });

    it("leaves the amount as it was entered when the fund is short by half a centavo or more, or holds nothing", () => {
      const halfCentavo = WARS_UNIT / 200n;
      expect(decide(ALL, { ...WIDE, warsBalance: ALL.amount - halfCentavo })).toMatchObject({ kind: "propose-payment", amount: ALL.amount });
      expect(decide(PITCH, { warsBalance: PITCH.amount - halfCentavo })).toMatchObject({ kind: "wait" });
      expect(decide({ ...ALL, amount: 1n }, { ...WIDE, warsBalance: 0n })).toMatchObject({ kind: "propose-payment", amount: 1n });
    });

    it("takes its proposal of what the fund held as this expense's, even once the fund holds more", () => {
      const earlier = proposed(AGENT, BLOCK - 600n, 42, { a: MEMBER, amount: HELD, note: "carne+bebida" });
      const richer = { ...WIDE, warsBalance: 60_000n * WARS_UNIT };
      expect(decide(ALL, richer, [earlier])).toEqual({
        kind: "proposed",
        transactionHash: earlier.transactionHash,
        reason: `Already proposed, in transaction ${earlier.transactionHash}`,
      });
      // Half a centavo below the amount entered is another expense's: amounts are entered in centavos.
      const another = proposed(AGENT, BLOCK - 600n, 43, { a: MEMBER, amount: ALL.amount - WARS_UNIT / 200n, note: "carne+bebida" });
      expect(decide(ALL, richer, [another])).toMatchObject({ kind: "propose-payment", amount: ALL.amount });
    });
  });

  it("keeps the proposal's note to 140 characters", () => {
    const decision = decide({ ...PITCH, kind: "other", note: `  ${"á".repeat(200)}  ` });
    expect(decision).toMatchObject({ kind: "propose-payment", note: "á".repeat(140) });
  });
});

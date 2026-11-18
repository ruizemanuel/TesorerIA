import { type Address, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { type Expense, decideExpense } from "../src/expense";
import { type FundSnapshot, proposalQuota, weekStartBlock } from "../src/fund";
import { reimbursementLimits } from "../src/limits";
import type { FundEvent } from "../src/events";
import {
  AGENT,
  BLOCK,
  MEMBERS,
  OUTSIDER,
  USDT_UNIT,
  WARS_UNIT,
  fundSnapshot,
  fundSnapshotV2,
  fundSnapshotWithoutDollar,
  proposed,
  ref,
  reimbursed,
} from "./support/fixtures";

const MEMBER = MEMBERS[1] as Address;
const QUIET_DAY = { reimbursed: 0n, convertedDollar: 0n, transactions: 0 };
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

  it("always puts a contribution given back to the vote, even one that fits in the week's cap", () => {
    expect(decide({ ...PITCH, kind: "give-back", amount: 10_000n * WARS_UNIT, note: "Deposité en otro fondo" })).toEqual({
      kind: "propose-payment",
      member: MEMBER,
      amount: 10_000n * WARS_UNIT,
      note: "Deposité en otro fondo",
      reason: "A contribution given back is always voted on",
    });
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
    const bigCap = { weeklyCap: 1_000_000n * WARS_UNIT, currencyBalance: 1_000_000n * WARS_UNIT };
    const { perReimbursement, perDay } = reimbursementLimits(fundSnapshot());
    const overOne = decide({ ...PITCH, amount: perReimbursement + 1n }, bigCap);
    expect(overOne).toMatchObject({ kind: "propose-payment", reason: "It's above the agent's per-reimbursement limit" });
    const busy = { ...QUIET_DAY, reimbursed: perDay - 1n };
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
    expect(decide(PITCH, { currencyBalance: 44_999n * WARS_UNIT })).toEqual({
      kind: "wait",
      reason: "The fund doesn't hold enough wARS yet",
    });
  });

  it("waits when a wMXN fund doesn't hold enough wMXN yet", () => {
    const fund = fundSnapshotWithoutDollar("wMXN", { currencyBalance: 1_099n * WARS_UNIT });
    const pitch = { ...PITCH, amount: 1_100n * WARS_UNIT };
    expect(decideExpense({ expense: pitch, fund, events: [], today: QUIET_DAY, now: NOW })).toEqual({
      kind: "wait",
      reason: "The fund doesn't hold enough wMXN yet",
    });
  });

  it("says wMXN in the week's cap and holds the agent's limits in wMXN", () => {
    const decideMxn = (amount: bigint, change: Parameters<typeof fundSnapshotWithoutDollar>[1] = {}, today = QUIET_DAY) =>
      decideExpense({
        expense: { ...PITCH, amount },
        fund: fundSnapshotWithoutDollar("wMXN", { weeklyCap: 10_000n * WARS_UNIT, currencyBalance: 10_000n * WARS_UNIT, ...change }),
        events: [],
        today,
        now: NOW,
      });
    expect(decideMxn(1_100n * WARS_UNIT)).toMatchObject({ kind: "reimburse", amount: 1_100n * WARS_UNIT });
    expect(decideMxn(1_101n * WARS_UNIT)).toMatchObject({ kind: "propose-payment", reason: "It's above the agent's per-reimbursement limit" });
    const busy = { ...QUIET_DAY, reimbursed: 1_000n * WARS_UNIT };
    expect(decideMxn(1_100n * WARS_UNIT, {}, busy)).toMatchObject({ kind: "propose-payment", reason: "It's above the agent's daily reimbursement limit" });
    expect(decideMxn(1_100n * WARS_UNIT, { spentThisWeek: 9_500n * WARS_UNIT })).toMatchObject({
      kind: "propose-payment",
      reason: "It doesn't fit in what's left of this week's cap (500 wMXN)",
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
    const WIDE = { weeklyCap: 1_000_000n * WARS_UNIT, currencyBalance: HELD };

    it("proposes what the fund holds, so the proposal can be paid", () => {
      expect(decide(ALL, WIDE)).toMatchObject({ kind: "propose-payment", amount: HELD });
    });

    it("pays the agreed expense back with what the fund holds, instead of waiting", () => {
      const pitch = { ...PITCH, amount: 45_000n * WARS_UNIT };
      const held = pitch.amount - 3_062_119_460_088_820n;
      expect(decide(pitch, { currencyBalance: held })).toEqual({ kind: "reimburse", member: MEMBER, amount: held, ref: PITCH.ref });
    });

    it("leaves the amount as it was entered when the fund is short by half a centavo or more, or holds nothing", () => {
      const halfCentavo = WARS_UNIT / 200n;
      expect(decide(ALL, { ...WIDE, currencyBalance: ALL.amount - halfCentavo })).toMatchObject({ kind: "propose-payment", amount: ALL.amount });
      expect(decide(PITCH, { currencyBalance: PITCH.amount - halfCentavo })).toMatchObject({ kind: "wait" });
      expect(decide({ ...ALL, amount: 1n }, { ...WIDE, currencyBalance: 0n })).toMatchObject({ kind: "propose-payment", amount: 1n });
    });

    it("takes its proposal of what the fund held as this expense's, even once the fund holds more", () => {
      const earlier = proposed(AGENT, BLOCK - 600n, 42, { a: MEMBER, amount: HELD, note: "carne+bebida" });
      const richer = { ...WIDE, currencyBalance: 60_000n * WARS_UNIT };
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

describe("decideExpense in a v2 fund: give-backs by vote and the agent's weekly proposals", () => {
  const GIVE_BACK: Expense = { ...PITCH, kind: "give-back", amount: 10_000n * WARS_UNIT, note: "Deposité en otro fondo" };
  const OTHER: Expense = { ...PITCH, kind: "other", note: "Pelotas nuevas" };
  const decideIn = (fund: FundSnapshot, expense: Expense, events: readonly FundEvent[] = []) =>
    decideExpense({ expense, fund, events, today: QUIET_DAY, now: NOW });

  /** A v2 fund of `n` members, each with 30,000 wARS contributed and nothing pending. */
  function fundOf(n: number, change: Partial<FundSnapshot> = {}): FundSnapshot {
    const members = Array.from({ length: n }, (_, i) => getAddress(`0x${(0xcc00 + i).toString(16).padStart(40, "0")}`));
    return fundSnapshotV2({
      members,
      contributed: members.map(() => 30_000n * WARS_UNIT),
      totalContributed: BigInt(n) * 30_000n * WARS_UNIT,
      pendingDollar: members.map(() => 0n),
      pendingValue: members.map(() => 0n),
      ...change,
    });
  }
  /** What the agent proposed in this week for `member`, in a block after the week's first. */
  const proposedFor = (fund: FundSnapshot, member: Address, tx: number, note = `earlier ${tx}`) =>
    proposed(AGENT, weekStartBlock(fund) + 1n + BigInt(tx), tx, { a: member, amount: 2n, note });

  it("proposes a GiveBack in a v2 fund", () => {
    expect(decideIn(fundSnapshotV2(), GIVE_BACK)).toEqual({
      kind: "propose-give-back",
      member: MEMBER,
      amount: 10_000n * WARS_UNIT,
      note: "Deposité en otro fondo",
      reason: "A contribution given back is always voted on",
    });
  });

  it("rejects a give-back above what the member contributed and has pending, saying how much they can ask for", () => {
    // 30,000 contributed, and 1,000 pending that comes out as 997.5 once the 0.25% fee is taken.
    const fund = fundSnapshotV2({ pendingDollar: [0n, 700n * USDT_UNIT, 0n], pendingValue: [0n, 1_000n * WARS_UNIT, 0n] });
    expect(decideIn(fund, { ...GIVE_BACK, amount: 31_000n * WARS_UNIT })).toEqual({
      kind: "reject",
      reason: "Above what the member contributed and has pending: they can ask for at most 30997.5 wARS",
    });
    // What they can ask for is the member's own, not the fund's.
    expect(decideIn(fund, { ...GIVE_BACK, member: MEMBERS[0] as Address, amount: 30_001n * WARS_UNIT })).toEqual({
      kind: "reject",
      reason: "Above what the member contributed and has pending: they can ask for at most 30000 wARS",
    });
  });

  it("waits on a give-back that their pending dollars will cover once converted", () => {
    const fund = fundSnapshotV2({ pendingDollar: [0n, 700n * USDT_UNIT, 0n], pendingValue: [0n, 1_000n * WARS_UNIT, 0n] });
    const waits = {
      kind: "wait",
      reason: "The member's pending dollars have to be converted first: it's above what they have contributed so far",
    };
    expect(decideIn(fund, { ...GIVE_BACK, amount: 30_001n * WARS_UNIT })).toEqual(waits);
    // Up to what the conversion will credit, net of the fee (997.5); one unit more is a rejection.
    const covered = 30_997n * WARS_UNIT + WARS_UNIT / 2n;
    expect(decideIn(fund, { ...GIVE_BACK, amount: covered })).toEqual(waits);
    expect(decideIn(fund, { ...GIVE_BACK, amount: covered + 1n })).toMatchObject({ kind: "reject" });
    // What they contributed already is proposed at once, whatever they have pending.
    expect(decideIn(fund, { ...GIVE_BACK, amount: 30_000n * WARS_UNIT })).toMatchObject({ kind: "propose-give-back" });
  });

  it("still proposes a Pay for a give-back in a v1 fund", () => {
    // The v1 contract has no GiveBack, and no contribution to compare with: it's a payment the members vote on.
    expect(decide(GIVE_BACK)).toEqual({
      kind: "propose-payment",
      member: MEMBER,
      amount: GIVE_BACK.amount,
      note: "Deposité en otro fondo",
      reason: "A contribution given back is always voted on",
    });
    expect(decide({ ...GIVE_BACK, amount: 40_000n * WARS_UNIT })).toMatchObject({ kind: "propose-payment", amount: 40_000n * WARS_UNIT });
  });

  it("finds its own earlier GiveBack proposal", () => {
    const ours = { a: MEMBER, amount: GIVE_BACK.amount, note: GIVE_BACK.note };
    const earlier = proposed(AGENT, BLOCK - 600n, 42, { ...ours, action: 8 });
    expect(decideIn(fundSnapshotV2(), GIVE_BACK, [earlier])).toEqual({
      kind: "proposed",
      transactionHash: earlier.transactionHash,
      reason: `Already proposed, in transaction ${earlier.transactionHash}`,
    });
    // A Pay of the same amount to the same member isn't this give-back's, and a GiveBack isn't an expense's Pay.
    const aPay = proposed(AGENT, BLOCK - 600n, 43, { ...ours, action: 0 });
    expect(decideIn(fundSnapshotV2(), GIVE_BACK, [aPay])).toMatchObject({ kind: "propose-give-back" });
    expect(decideIn(fundSnapshotV2(), { ...OTHER, amount: ours.amount, note: ours.note }, [earlier])).toMatchObject({ kind: "propose-payment" });
    // In a v1 fund a give-back is a Pay, so it's a Pay that it finds.
    expect(decideIn(fundSnapshot(), GIVE_BACK, [aPay])).toMatchObject({ kind: "proposed", transactionHash: aPay.transactionHash });
  });

  it("says proposed, not proposal-quota, for a proposal that went out and took the last place", () => {
    const fund = fundSnapshotV2({ agentProposalsThisWeek: 10n });
    const giveBack = proposed(AGENT, BLOCK - 30n, 42, { action: 8, a: MEMBER, amount: GIVE_BACK.amount, note: GIVE_BACK.note });
    expect(decideIn(fund, GIVE_BACK, [giveBack])).toMatchObject({ kind: "proposed", transactionHash: giveBack.transactionHash });
    const pay = proposed(AGENT, BLOCK - 30n, 43, { a: MEMBER, amount: OTHER.amount, note: OTHER.note });
    expect(decideIn(fund, OTHER, [pay])).toMatchObject({ kind: "proposed", transactionHash: pay.transactionHash });
    // Without it, the same fund has no place left for them.
    expect(decideIn(fund, GIVE_BACK)).toMatchObject({ kind: "wait", code: "proposal-quota" });
  });

  it("lets one member of three use 8 proposals while the other two haven't made any, and the ninth waits", () => {
    const events: FundEvent[] = [];
    for (let used = 0; used < 8; used++) {
      const fund = fundSnapshotV2({ agentProposalsThisWeek: BigInt(used) });
      expect(decideIn(fund, OTHER, events), `proposal ${used + 1}`).toMatchObject({ kind: "propose-payment" });
      events.push(proposedFor(fund, MEMBER, used));
    }
    const ninth = fundSnapshotV2({ agentProposalsThisWeek: 8n });
    expect(decideIn(ninth, OTHER, events)).toEqual({
      kind: "wait",
      code: "proposal-quota",
      reason: "The agent's proposals for this week are shared among the members and none is left for this one: it will be proposed when next week starts",
    });
    expect(decideIn(ninth, GIVE_BACK, events)).toMatchObject({ kind: "wait", code: "proposal-quota" });
    // The other two still have theirs.
    expect(decideIn(ninth, { ...OTHER, member: MEMBERS[0] as Address }, events)).toMatchObject({ kind: "propose-payment" });
    expect(proposalQuota(ninth, events, MEMBER)).toEqual({ used: 8, left: 0 });
    expect(proposalQuota(ninth, events, MEMBERS[0] as Address)).toEqual({ used: 0, left: 1 });
  });

  it("keeps one proposal for each of the other 9 members of a 10-member fund", () => {
    const fund = fundOf(10);
    const [first, second] = fund.members as [Address, Address];
    expect(proposalQuota(fund, [], first)).toEqual({ used: 0, left: 1 });
    expect(decideIn(fund, { ...OTHER, member: first })).toMatchObject({ kind: "propose-payment" });

    // The first one's went out: their second waits, and the second member still has theirs.
    const afterFirst = fundOf(10, { agentProposalsThisWeek: 1n });
    const events = [proposedFor(afterFirst, first, 1)];
    expect(proposalQuota(afterFirst, events, first)).toEqual({ used: 1, left: 0 });
    expect(decideIn(afterFirst, { ...OTHER, member: first }, events)).toMatchObject({ kind: "wait", code: "proposal-quota" });
    expect(proposalQuota(afterFirst, events, second)).toEqual({ used: 0, left: 1 });
    expect(decideIn(afterFirst, { ...OTHER, member: second }, events)).toMatchObject({ kind: "propose-payment" });

    // Once each of the other 9 has made one, the first has the last place.
    const nine = fundOf(10, { agentProposalsThisWeek: 9n });
    const others = nine.members.slice(1).map((m, i) => proposedFor(nine, m, i + 1));
    expect(proposalQuota(nine, others, first)).toEqual({ used: 0, left: 1 });
  });

  it("waits when the contract's count for the agent is 10", () => {
    // Nothing in the history says who the 10 were for (the log may be behind): the contract's count is the one that reverts.
    const full = fundSnapshotV2({ agentProposalsThisWeek: 10n });
    expect(decideIn(full, OTHER)).toMatchObject({ kind: "wait", code: "proposal-quota" });
    expect(decideIn(full, GIVE_BACK)).toMatchObject({ kind: "wait", code: "proposal-quota" });
    expect(proposalQuota(full, [], MEMBER)).toEqual({ used: 0, left: 0 });
    // The agreed expense that doesn't fit in the week's cap is a proposal too.
    const overTheCap = fundSnapshotV2({ agentProposalsThisWeek: 10n, spentThisWeek: 50_000n * WARS_UNIT });
    expect(decideIn(overTheCap, PITCH)).toMatchObject({ kind: "wait", code: "proposal-quota" });
  });

  it("pays the agreed expense back with no proposals left: a reimbursement is not a proposal", () => {
    expect(decideIn(fundSnapshotV2({ agentProposalsThisWeek: 10n }), PITCH)).toMatchObject({ kind: "reimburse" });
  });

  it("doesn't count a proposal from last week", () => {
    const fund = fundSnapshotV2();
    const start = weekStartBlock(fund);
    // Eight for MEMBER from the week that closed; the contract's count started over.
    const lastWeek = Array.from({ length: 8 }, (_, i) => proposed(AGENT, start - 1n - BigInt(i), 100 + i, { a: MEMBER, amount: 2n, note: `old ${i}` }));
    expect(proposalQuota(fund, lastWeek, MEMBER)).toEqual({ used: 0, left: 8 });
    expect(decideIn(fund, OTHER, lastWeek)).toMatchObject({ kind: "propose-payment" });
    // The week's first block is the week's (and the contract's count has that one).
    const first = proposed(AGENT, start, 120, { a: MEMBER, amount: 2n, note: "first" });
    expect(proposalQuota({ ...fund, agentProposalsThisWeek: 1n }, [...lastWeek, first], MEMBER)).toEqual({ used: 1, left: 7 });
  });

  it("counts the agent's proposals only, each for the member it names", () => {
    const fund = fundSnapshotV2({ agentProposalsThisWeek: 1n });
    const mine = proposedFor(fund, MEMBER, 1);
    // A member's own proposals, even ones naming MEMBER, aren't the agent's.
    const theirs = [
      proposed(MEMBERS[0] as Address, BLOCK - 50n, 2, { a: MEMBERS[0] as Address }),
      proposed(MEMBERS[2] as Address, BLOCK - 50n, 3, { a: MEMBER }),
    ];
    expect(proposalQuota(fund, [mine, ...theirs], MEMBER)).toEqual({ used: 1, left: 7 });
    expect(proposalQuota(fund, [mine, ...theirs], MEMBERS[0] as Address)).toEqual({ used: 0, left: 8 });
    // Whatever the case of the address in the event.
    const lowercase = proposed(AGENT, BLOCK - 50n, 4, { a: MEMBER.toLowerCase() as Address });
    expect(proposalQuota(fund, [lowercase], MEMBER)).toMatchObject({ used: 1 });
  });

  it("has no quota in a v1 fund", () => {
    expect(proposalQuota(fundSnapshot(), [], MEMBER)).toBeNull();
    // Whatever the agent proposed this week, a v1 fund proposes: the contract has no per-week count.
    const events = Array.from({ length: 12 }, (_, i) => proposed(AGENT, BLOCK - 50n, 100 + i, { a: MEMBER, note: `earlier ${i}` }));
    expect(decide(OTHER, {}, events)).toMatchObject({ kind: "propose-payment" });
    expect(decide(GIVE_BACK, {}, events)).toMatchObject({ kind: "propose-payment" });
  });
});

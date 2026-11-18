import { type Address, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { buildFundView } from "../src/lib/fund-view";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { ANA, BETO, CARO, USDT_UNIT, WARS, snapshot } from "./support/fixtures";

const NAMES = new Map<Address, string>([
  [ANA, "Ana"],
  [BETO, "Beto"],
]);

function view(change: Parameters<typeof snapshot>[0] = {}, viewer: Address | null = ANA, joined = new Map<Address, bigint>(), m = es) {
  return buildFundView({
    snapshot: snapshot(change),
    name: "Fútbol de los jueves",
    agreedExpense: "la cancha",
    balance: 100_000n * WARS,
    weeklyFee: 10_000n * WARS,
    joined,
    names: NAMES,
    viewer,
    m,
  });
}

describe("buildFundView", () => {
  it("says the contract's week, counted from 0", () => {
    expect(view().week).toBe(2n);
  });

  it("lists the members in the contract's order, with what each still owes through this week", () => {
    const { rows, me } = view({ contributed: [30_000n * WARS, 30_000n * WARS, 10_000n * WARS], totalContributed: 70_000n * WARS });
    expect(rows).toEqual([
      { position: 1, member: ANA, name: "Ana", isMe: true, owed: 0n },
      { position: 2, member: BETO, name: "Beto", isMe: false, owed: 0n },
      { position: 3, member: CARO, name: "Miembro 3", isMe: false, owed: 20_000n * WARS },
    ]);
    expect(me?.owed).toBe(0n);
  });

  it("names a member without a name in the page's language: Member N in English", () => {
    const { rows } = view({}, ANA, new Map(), en);
    expect(rows.map((row) => row.name)).toEqual(["Ana", "Beto", "Member 3"]);
  });

  it("counts a later member's fees from the week they joined", () => {
    const { rows } = view({ contributed: [30_000n * WARS, 30_000n * WARS, 10_000n * WARS] }, ANA, new Map([[CARO, 2n]]));
    expect(rows[2]?.owed).toBe(0n);
  });

  it("gives your part if it closed today in proportion to what you put in, or equal parts if no one did", () => {
    const uneven = view({ contributed: [30_000n * WARS, 30_000n * WARS, 10_000n * WARS], totalContributed: 70_000n * WARS });
    expect(uneven.me?.share).toBe((100_000n * WARS * 30_000n * WARS) / (70_000n * WARS));
    const none = view({ contributed: [0n, 0n, 0n], totalContributed: 0n }, BETO);
    expect(none.me?.share).toBe((100_000n * WARS) / 3n);
    expect(view({}, null).me).toBeNull();
    expect(view({}, getAddress("0x0000000000000000000000000000000000000bad")).me).toBeNull();
  });

  it("says what you paid ahead from 1 % of a weekly fee up; below that it's Aportar's margin on USDT", () => {
    // The fixture's fund is in its third week: $ 30.000 due each (the first test's Caro owes 20.000 of them).
    const ahead = (contributed: bigint) =>
      view({ contributed: [contributed, 30_000n * WARS, 30_000n * WARS], totalContributed: contributed + 60_000n * WARS }).me?.ahead;
    expect(ahead(31_000n * WARS)).toBe(1_000n * WARS);
    expect(ahead(30_100n * WARS)).toBe(100n * WARS);
    expect(ahead(30_099n * WARS)).toBe(0n);
    expect(ahead(30_000n * WARS)).toBe(0n);
    expect(ahead(29_000n * WARS)).toBe(0n); // owes instead
  });

  it("doesn't count what was given back of your contributions as paid ahead, while your part stays the contract's (spec, 7.3)", () => {
    // The real case: Member 7 put in 60.012,34 by week 5 and was given 10.000 back. Here, Ana by week 2.
    const contributed = [40_012_340_000_000_000_000_000n, 30_000n * WARS, 30_000n * WARS];
    const total = contributed.reduce((a, b) => a + b, 0n);
    const given = (back: bigint) =>
      buildFundView({
        snapshot: snapshot({ contributed, totalContributed: total }),
        name: "Fútbol de los jueves",
        agreedExpense: "la cancha",
        balance: 100_000n * WARS,
        weeklyFee: 10_000n * WARS,
        joined: new Map(),
        givenBack: new Map([[ANA, back]]),
        names: NAMES,
        viewer: ANA,
        m: es,
      });
    expect(given(0n).me?.ahead).toBe(10_012_340_000_000_000_000_000n); // what her screen said
    // $ 12,34 ahead is under 1 % of the fee, Aportar's margin: nothing to say. Given 5.000 back, she's 5.012,34 ahead.
    expect(given(10_000n * WARS).me?.ahead).toBe(0n);
    expect(given(5_000n * WARS).me?.ahead).toBe(5_012_340_000_000_000_000_000n);
    expect(given(10_000n * WARS).me?.owed).toBe(0n);
    // Fund._split still counts the 10.000: the contract can't lower what she contributed.
    expect(given(10_000n * WARS).me?.share).toBe((100_000n * WARS * contributed[0]!) / total);
    // Given back more than she's ahead by, she owes the rest.
    expect(given(20_000n * WARS).rows[0]?.owed).toBe(9_987_660_000_000_000_000_000n);
  });

  it("counts what converting your USDT lost as not put in, while your part stays the contract's (conversion-loss design)", () => {
    const contributed = [30_000n * WARS, 30_000n * WARS, 30_000n * WARS];
    const lost = (loss: bigint) =>
      buildFundView({
        snapshot: snapshot({ contributed, totalContributed: 90_000n * WARS }),
        name: "Fútbol de los jueves",
        agreedExpense: "la cancha",
        balance: 100_000n * WARS,
        weeklyFee: 10_000n * WARS,
        joined: new Map(),
        conversionLoss: new Map([[ANA, loss]]),
        names: NAMES,
        viewer: ANA,
        m: es,
      });
    expect(lost(60n * WARS).rows[0]?.owed).toBe(60n * WARS);
    expect(lost(60n * WARS).me?.owed).toBe(60n * WARS);
    expect(lost(60n * WARS).me?.share).toBe(lost(0n).me?.share);
  });

  it("after paying what Aportar asked, a conversion that lost up to 0,3 % leaves no debt and nothing ahead; one that lost more than that and $ 50 does", () => {
    // Week 0: Ana sent the fee plus Aportar's 0,3 %, credited at 10.030.
    const paid = (loss: bigint) =>
      buildFundView({
        snapshot: snapshot({ week: 0n, contributed: [10_030n * WARS, 10_000n * WARS, 10_000n * WARS], totalContributed: 30_030n * WARS }),
        name: "Fútbol de los jueves",
        agreedExpense: "la cancha",
        balance: 30_000n * WARS,
        weeklyFee: 10_000n * WARS,
        joined: new Map(),
        conversionLoss: new Map([[ANA, loss]]),
        names: NAMES,
        viewer: ANA,
        m: es,
      }).me;
    expect(paid((2_407n * WARS) / 100n)).toMatchObject({ owed: 0n, ahead: 0n }); // 0,24 %, the worst measured
    expect(paid(100n * WARS)).toMatchObject({ owed: 70n * WARS, ahead: 0n });
  });

  it("a v2 member's share counts their own pending dollars", () => {
    // Caro's 6 USDT are still pending, worth 10.000 at the TWAP: the close gives them back to her whole, and splits the
    // rest of the balance (90.000) by what each contributed, or in equal parts if no one did.
    const share = (viewer: Address, contributed: bigint[]) =>
      view(
        {
          version: 2,
          feeBps: 25,
          contributed,
          totalContributed: contributed.reduce((a, b) => a + b, 0n),
          pendingDollar: [0n, 0n, 6n * USDT_UNIT],
          pendingValue: [0n, 0n, 10_000n * WARS],
          totalPendingDollar: 6n * USDT_UNIT,
          dollarBalance: 6n * USDT_UNIT,
        },
        viewer,
      ).me?.share;
    expect(share(ANA, [30_000n * WARS, 30_000n * WARS, 0n])).toBe(45_000n * WARS);
    expect(share(CARO, [30_000n * WARS, 30_000n * WARS, 0n])).toBe(10_000n * WARS);
    expect(share(CARO, [30_000n * WARS, 30_000n * WARS, 20_000n * WARS])).toBe((90_000n * WARS * 20_000n) / 80_000n + 10_000n * WARS);
    expect(share(ANA, [0n, 0n, 0n])).toBe(30_000n * WARS);
    expect(share(CARO, [0n, 0n, 0n])).toBe(40_000n * WARS);
  });

  it("says what's left of the week's cap, never below zero", () => {
    expect(view({ spentThisWeek: 45_000n * WARS }).leftThisWeek).toBe(15_000n * WARS);
    expect(view({ spentThisWeek: 70_000n * WARS, weeklyCap: 60_000n * WARS }).leftThisWeek).toBe(0n);
  });
});

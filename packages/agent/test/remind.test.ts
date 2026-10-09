import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import type { FundEvent } from "../src/events";
import { closeShares, joinWeeks, memberDues } from "../src/remind";
import { MEMBERS, OUTSIDER, USDT_UNIT, WARS_UNIT, fundSnapshot, memberAdded, memberReplaced } from "./support/fixtures";

const [ANA, BETO, CARLA] = MEMBERS as [Address, Address, Address];
const FEE = 10_000n * WARS_UNIT;

describe("joinWeeks", () => {
  it("dates an added member by its event, and a replacement by its predecessor", () => {
    const weekOfBlock = new Map([
      [100n, 1n],
      [200n, 3n],
    ]);
    const events = [memberAdded(OUTSIDER, 100n), memberReplaced(OUTSIDER, CARLA, 200n), memberReplaced(ANA, BETO, 200n)];
    const weeks = joinWeeks(events, (event: FundEvent) => weekOfBlock.get(event.blockNumber) ?? 0n);
    expect(weeks).toEqual(
      new Map([
        [OUTSIDER, 1n],
        [CARLA, 1n],
        [BETO, 0n],
      ]),
    );
  });
});

describe("memberDues", () => {
  it("counts the fee from the week each member joined through the current one", () => {
    // Week 2: the founders owe three fees; Carla joined in week 1 and owes two.
    const fund = fundSnapshot({ contributed: [30_000n * WARS_UNIT, 20_000n * WARS_UNIT, 0n] });
    const dues = memberDues({ fund, weeklyFee: FEE, joined: new Map([[CARLA, 1n]]) });
    expect(dues).toEqual([
      { member: ANA, due: 30_000n * WARS_UNIT, contributed: 30_000n * WARS_UNIT, owed: 0n },
      { member: BETO, due: 30_000n * WARS_UNIT, contributed: 20_000n * WARS_UNIT, owed: 10_000n * WARS_UNIT },
      { member: CARLA, due: 20_000n * WARS_UNIT, contributed: 0n, owed: 20_000n * WARS_UNIT },
    ]);
  });

  it("owes nothing to whoever paid ahead", () => {
    const fund = fundSnapshot({ contributed: [90_000n * WARS_UNIT, 30_000n * WARS_UNIT, 30_000n * WARS_UNIT] });
    expect(memberDues({ fund, weeklyFee: FEE, joined: new Map() })[0]?.owed).toBe(0n);
  });
});

describe("closeShares", () => {
  it("splits both balances in proportion to contributions, and measures how uneven they are", () => {
    const fund = fundSnapshot({
      contributed: [50_000n * WARS_UNIT, 30_000n * WARS_UNIT, 20_000n * WARS_UNIT],
      totalContributed: 100_000n * WARS_UNIT,
      warsBalance: 40_000n * WARS_UNIT,
      usdtBalance: 10n * USDT_UNIT,
    });
    const { shares, spread } = closeShares(fund);
    expect(shares.map((s) => [s.wars, s.usdt])).toEqual([
      [20_000n * WARS_UNIT, 5n * USDT_UNIT],
      [12_000n * WARS_UNIT, 3n * USDT_UNIT],
      [8_000n * WARS_UNIT, 2n * USDT_UNIT],
    ]);
    expect(spread).toBe(30_000n * WARS_UNIT);
  });

  it("splits equally when no one contributed, like the contract", () => {
    const fund = fundSnapshot({ contributed: [0n, 0n, 0n], totalContributed: 0n, warsBalance: 9n, usdtBalance: 3n });
    expect(closeShares(fund).shares.map((s) => [s.wars, s.usdt])).toEqual([
      [3n, 1n],
      [3n, 1n],
      [3n, 1n],
    ]);
  });
});

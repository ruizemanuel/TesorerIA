import { type Address, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { buildFundView } from "../src/lib/fund-view";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { ANA, BETO, CARO, WARS, snapshot } from "./support/fixtures";

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

  it("says what's left of the week's cap, never below zero", () => {
    expect(view({ spentThisWeek: 45_000n * WARS }).leftThisWeek).toBe(15_000n * WARS);
    expect(view({ spentThisWeek: 70_000n * WARS, weeklyCap: 60_000n * WARS }).leftThisWeek).toBe(0n);
  });
});

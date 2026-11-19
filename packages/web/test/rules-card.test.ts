import { FEE_BPS, USDT, WARS } from "@tesoreria/agent";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { RulesCard } from "../src/components/rules-card";
import { NBSP, WARS_UNIT } from "../src/lib/format";
import type { FundView } from "../src/lib/fund-view";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";

/** A fund of three on Inicio: version 1 (no fee) unless `change` says otherwise. */
function view(change: Partial<FundView> = {}): FundView {
  const rows = [1, 2, 3].map((position) => ({
    position,
    member: getAddress(`0x${position.toString(16).padStart(40, "0")}`),
    name: `Miembro ${position}`,
    isMe: false,
    owed: 0n,
  }));
  return {
    address: getAddress("0x00000000000000000000000000000000000f00d1"),
    name: "Fútbol de los jueves",
    agreedExpense: "la cancha",
    closed: false,
    balance: 80_000n * WARS_UNIT,
    version: 1,
    currency: WARS,
    dollar: USDT,
    feeBps: 0,
    balanceCap: 450_000n * WARS_UNIT,
    counted: 80_000n * WARS_UNIT,
    weeklyFee: 10_000n * WARS_UNIT,
    weeklyCap: 60_000n * WARS_UNIT,
    spentThisWeek: 0n,
    leftThisWeek: 60_000n * WARS_UNIT,
    votesRequired: 2,
    week: 2n,
    rows,
    me: null,
    ...change,
  };
}

const V2 = { version: 2, feeBps: FEE_BPS } as const;

describe("RulesCard: the rules on a fund's Inicio", () => {
  it("says a version 2 fund's fee after its rules, in each language (spec, 5.5)", () => {
    const spanish = renderToStaticMarkup(createElement(RulesCard, { view: view(V2), m: es, locale: "es" }));
    expect(spanish).toContain(
      `Nadie puede cambiar esto solo, ni el agente. El 0,25${NBSP}% de cada aporte va a TesorerIA para cubrir lo que cuestan las operaciones del fondo. Sale una vez por semana, sin votación, y nadie puede cambiarlo.`,
    );
    const english = renderToStaticMarkup(createElement(RulesCard, { view: view(V2), m: en, locale: "en" })).replaceAll("&#x27;", "'");
    expect(english).toContain(
      "No one can change this alone, not even the agent. 0.25% of each contribution goes to TesorerIA to cover what the fund's operations cost. It goes out once a week, without a vote, and nobody can change it.",
    );
  });

  it("says no fee for a version 1 fund, which has none", () => {
    for (const [m, locale] of [
      [es, "es"],
      [en, "en"],
    ] as const) {
      const html = renderToStaticMarkup(createElement(RulesCard, { view: view(), m, locale }));
      expect(html).not.toContain("TesorerIA");
      expect(html).toMatch(/(ni el agente|not even the agent)\.<\/p>/);
    }
  });
});

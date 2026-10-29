import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type Address, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { HomeRules } from "../src/components/home-rules";
import { NBSP, WARS_UNIT } from "../src/lib/format";
import type { FundView } from "../src/lib/fund-view";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";

const FUND = getAddress("0x9A74F670F3c59Ae4B8450fdD477b0461b89D2dfD");

/** The real group's fund as the portada reads it: 8 members, 5 votes, and a week with part of its cap spent. */
function view(): FundView {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    position: i + 1,
    member: getAddress(`0x${(i + 1).toString(16).padStart(40, "0")}`) as Address,
    name: `Miembro ${i + 1}`,
    isMe: false,
    owed: 0n,
  }));
  return {
    address: FUND,
    name: "Fútbol de los jueves",
    agreedExpense: "la cancha",
    closed: false,
    balance: 120_000n * WARS_UNIT,
    weeklyFee: 10_000n * WARS_UNIT,
    weeklyCap: 60_000n * WARS_UNIT,
    spentThisWeek: 45_000n * WARS_UNIT,
    leftThisWeek: 15_000n * WARS_UNIT,
    votesRequired: 5,
    week: 2n,
    rows,
    me: null,
  };
}

describe("HomeRules: the portada's card with the real fund's own numbers", () => {
  it("says the fund's agreed expense, its whole weekly cap, its votes and its members, read from it", () => {
    const html = renderToStaticMarkup(createElement(HomeRules, { view: view(), m: es, locale: "es" }));
    expect(html).toContain("Qué hace el agente solo y qué se vota");
    // The cap, not what's left of it this week.
    expect(html).toMatch(new RegExp(`devuelve la cancha hasta <span[^>]*>\\$${NBSP}60\\.000</span> por semana`));
    expect(html).toContain("En Fútbol de los jueves hacen falta 5 de 8 votos.");
    expect(html).toContain("Si te vas, el grupo vota tu salida");
  });

  it("links the fund's own contract, not the FundFactory", () => {
    const html = renderToStaticMarkup(createElement(HomeRules, { view: view(), m: es, locale: "es" }));
    expect(html).toContain(`href="https://celo.blockscout.com/address/${FUND}"`);
    expect(html).toMatch(/<a [^>]*href="https:\/\/celo\.blockscout\.com\/address\/0x9A74F670F3c59Ae4B8450fdD477b0461b89D2dfD"[^>]*>el contrato del propio fondo<\/a>/);
  });

  it("says it in English, with the amounts as English writes them", () => {
    const html = renderToStaticMarkup(createElement(HomeRules, { view: view(), m: en, locale: "en" })).replaceAll("&#x27;", "'");
    expect(html).toMatch(new RegExp(`pays back “la cancha” up to <span[^>]*>ARS${NBSP}60,000</span> a week`));
    expect(html).toContain("In Fútbol de los jueves, it takes 5 of 8 votes.");
    expect(html).toContain(">the fund's own contract</a>");
  });
});

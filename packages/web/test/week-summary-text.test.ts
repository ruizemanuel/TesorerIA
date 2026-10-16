import type { WeekSummaryFacts } from "@tesoreria/agent";
import { type Address, getAddress, pad, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { NBSP } from "../src/lib/format";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { weekSummaryText } from "../src/lib/week-summaries";
import { WARS } from "./support/fixtures";

const account = (n: number): Address => getAddress(pad(toHex(n), { size: 20 }));
const [EMA, JUAN, PEDRO, ALE, CARO, DANI, FEDE, GABI] = [1, 2, 3, 4, 5, 6, 7, 8].map(account) as [
  Address, Address, Address, Address, Address, Address, Address, Address,
];
const NAMES = new Map<Address, string>([
  [EMA, "Ema"], [JUAN, "Juan"], [PEDRO, "Pedro"], [ALE, "Ale"], [CARO, "Caro"], [DANI, "Dani"], [FEDE, "Fede"], [GABI, "Gabi"],
]);
const LINK = "https://tesoreriaia.vercel.app/f/0x9A74F670F3c59Ae4B8450fdD477b0461b89D2dfD";
/** The real fund's first week: from Sunday 11/10 at 21:19 to Sunday 18/10, Buenos Aires time. */
const START = 1_791_764_388n;

/** The approved example (spec, 9.4): 6 of 8 paid, Juan and Pedro owe, the pitch paid back and the balls approved. */
function facts(change: Partial<WeekSummaryFacts> = {}): WeekSummaryFacts {
  return {
    week: 0n,
    block: 80_209_800n,
    startsAt: START,
    endsAt: START + 604_800n,
    balance: 80_000n * WARS,
    dues: [EMA, JUAN, PEDRO, ALE, CARO, DANI, FEDE, GABI].map((member) => ({
      member,
      owed: member === JUAN ? 10_000n * WARS : member === PEDRO ? 20_000n * WARS : 0n,
    })),
    contributed: 60_000n * WARS,
    reimbursements: [{ member: EMA, amount: 60_000n * WARS }],
    payments: [{ member: ALE, amount: 8_000n * WARS, note: "las pelotas" }],
    joined: [],
    ...change,
  };
}

const text = (f: WeekSummaryFacts, m = es, link: string | null = LINK, names = NAMES) =>
  weekSummaryText(f, { fundName: "Fútbol de los jueves", agreedExpense: "la cancha", names, link }, m);
/** The amounts keep their non-breaking space, as everywhere (formatPesos). */
const $ = (written: string) => written.replaceAll("$ ", `$${NBSP}`).replaceAll("ARS ", `ARS${NBSP}`);

describe("weekSummaryText: the summary that goes to the group (spec, 9.4)", () => {
  it("writes the approved text in Spanish, word for word", () => {
    expect(text(facts())).toBe(
      $(`TesorerIA · Fútbol de los jueves
Resumen de la semana 1 (del 11/10 al 18/10)

En el fondo hay $ 80.000.

Pagaron la cuota 6 de 8. Deben:
· Juan, $ 10.000
· Pedro, $ 20.000

Lo que pasó:
· Aportaron $ 60.000 entre todos.
· Le devolví $ 60.000 a Ema por la cancha.
· Se aprobó pagarle $ 8.000 a Ale por las pelotas.

Para aportar: ${LINK}`),
    );
  });

  it("writes it in English, with what the members wrote as they wrote it", () => {
    expect(text(facts(), en)).toBe(
      $(`TesorerIA · Fútbol de los jueves
Week 1 summary (Oct 11 to Oct 18)

The fund holds ARS 80,000.

6 of 8 paid their dues. Still owing:
· Juan, ARS 10,000
· Pedro, ARS 20,000

What happened:
· Together you contributed ARS 60,000.
· I paid Ema back ARS 60,000 for la cancha.
· Paying Ale ARS 8,000 for las pelotas was approved.

To contribute: ${LINK}`),
    );
  });

  it("says everyone paid instead of the list when nobody owes", () => {
    const allPaid = facts({ dues: facts().dues.map((d) => ({ ...d, owed: 0n })) });
    expect(text(allPaid)).toContain("\n\nTodos pagaron la cuota.\n\nLo que pasó:\n");
    expect(text(allPaid)).not.toContain("Deben:");
    expect(text(allPaid, en)).toContain("\n\nEveryone paid their dues.\n\nWhat happened:\n");
  });

  it("says nothing happened in a quiet week, and still lists who owes", () => {
    const quiet = facts({ contributed: 0n, reimbursements: [], payments: [], joined: [] });
    expect(text(quiet)).toContain($("· Pedro, $ 20.000\n\nNo hubo movimientos.\n\nPara aportar:"));
    expect(text(quiet)).not.toContain("Lo que pasó:");
    expect(text(quiet, en)).toContain($("· Pedro, ARS 20,000\n\nNo activity this week.\n\nTo contribute:"));
  });

  it("says who joined, with the movements' own sentence", () => {
    const lucas = account(9);
    const names = new Map([...NAMES, [lucas, "Lucas"]]);
    const joined = facts({ joined: [lucas] });
    expect(text(joined, es, LINK, names)).toContain("\n· Se sumó Lucas al fondo.\n");
    expect(text(joined, en, LINK, names)).toContain("\n· Lucas joined the fund.\n");
  });

  it("says 'una cuenta nueva' for a new member the fund has no name for, as the movements do (PF8)", () => {
    // Movimientos writes a MemberAdded with no known name as "una cuenta nueva" (timeline.ts), not as "alguien".
    const joined = facts({ joined: [account(9)] });
    expect(text(joined)).toContain("\n· Se sumó una cuenta nueva al fondo.\n");
    expect(text(joined, en)).toContain("\n· A new account joined the fund.\n");
  });

  it("says 'Alguien' for an account the fund has no name for, capitalized where it starts the line", () => {
    const names = new Map([...NAMES].filter(([member]) => member !== JUAN));
    expect(text(facts(), es, LINK, names)).toContain($("\n· Alguien, $ 10.000\n"));
    expect(text(facts(), en, LINK, names)).toContain($("\n· Someone, ARS 10,000\n"));
  });

  it("leaves the link out where there's nobody to send it to (the public view)", () => {
    expect(text(facts(), es, null).endsWith("las pelotas.")).toBe(true);
    expect(text(facts(), es, null)).not.toContain("Para aportar");
  });

  it("counts the weeks from 1, as people do", () => {
    expect(text(facts({ week: 2n, startsAt: START + 2n * 604_800n, endsAt: START + 3n * 604_800n }))).toContain("Resumen de la semana 3 (del 25/10 al 1/11)");
  });
});

import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NBSP, WARS_UNIT, parsePesos } from "../src/lib/format";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { LOCALES, LOCALE_NAMES } from "../src/lib/i18n/locales";
import { MESSAGES, type Messages, messagesFor } from "../src/lib/i18n/messages";

/** Every path to a leaf of a dictionary, so a missing or extra sentence shows by name. */
function paths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, inner]) => paths(inner, prefix === "" ? key : `${prefix}.${key}`));
}

describe("the dictionaries", () => {
  it("give each language its own", () => {
    expect(messagesFor("es")).toBe(es);
    expect(messagesFor("en")).toBe(en);
    expect(Object.keys(MESSAGES).sort()).toEqual([...LOCALES].sort());
  });

  it("have the same sentences in both languages, and each the same kind of thing", () => {
    // TypeScript checks this already; this catches a cast that hides a gap from it.
    expect(paths(en).sort()).toEqual(paths(es).sort());
    for (const path of paths(es)) {
      const kind = (dictionary: unknown) => typeof path.split(".").reduce<unknown>((at, key) => (at as Record<string, unknown>)[key], dictionary);
      expect(kind(en), path).toBe(kind(es));
    }
  });

  it("say the page's description in each language", () => {
    expect(es.meta.description).toBe("La plata del grupo, sin tesorero.");
    expect(en.meta.description).toBe("The group's treasury, without a treasurer.");
  });

  it("name each language in itself, for the switch", () => {
    expect(LOCALE_NAMES).toEqual({ es: "Español", en: "English" });
  });

  it("offer the defaults of a new fund in each language's own way of writing amounts", () => {
    expect(parsePesos(es.create.defaults.weeklyFee, "es")).toBe(10_000n * WARS_UNIT);
    expect(parsePesos(en.create.defaults.weeklyFee, "en")).toBe(10_000n * WARS_UNIT);
    expect(parsePesos(es.create.defaults.weeklyCap, "es")).toBe(60_000n * WARS_UNIT);
    expect(parsePesos(en.create.defaults.weeklyCap, "en")).toBe(60_000n * WARS_UNIT);
    expect(es.create.defaults.agreedExpense).toBe("la cancha");
  });

  it("put the pieces of a sentence where it says, in Spanish with the words it always had", () => {
    const html = (node: ReactNode) => renderToStaticMarkup(node);
    const link = (text: string) => createElement("a", null, text);
    const fund = createElement("em", null, "Fútbol");
    expect(html(es.invitation.title("Ana", fund))).toBe("Ana te invitó a <em>Fútbol</em>");
    expect(html(en.invitation.title("Ana", fund))).toBe("Ana invited you to <em>Fútbol</em>");
    const pesos = { fee: `$${NBSP}10.000`, cap: `$${NBSP}60.000` };
    const dollars = { fee: `ARS${NBSP}10,000`, cap: `ARS${NBSP}60,000` };
    expect(html(es.invitation.rules(pesos.fee, pesos.cap, "la cancha"))).toBe(
      `Cada uno pone ${pesos.fee} por semana. El agente devuelve hasta ${pesos.cap} por semana por la cancha. Todo lo demás se vota. Nadie puede cambiar esto solo, ni el agente.`,
    );
    expect(html(en.invitation.rules(dollars.fee, dollars.cap, "la cancha"))).toBe(
      `Each person puts in ${dollars.fee} per week. The agent pays back up to ${dollars.cap} per week for la cancha. Everything else is voted on. No one can change this alone, not even the agent.`,
    );
    const judges = (m: Messages) => {
      const { celo, contract, agent, code } = m.home.judgesLinks;
      return html(m.home.judges(link(celo), link(contract), link(agent), link(code)));
    };
    expect(judges(es)).toBe(
      "Corre en <a>Celo mainnet</a>, con <a>el contrato verificado</a>, <a>el agente registrado en ERC-8004 (#9887)</a> y <a>el código abierto</a>.",
    );
    expect(judges(en)).toBe(
      "Runs on <a>Celo mainnet</a>, with <a>the verified contract</a>, <a>the agent registered in ERC-8004 (#9887)</a> and <a>the open-source code</a>.",
    );
    expect(html(es.login.firstTime(link(es.login.createLink)))).toBe(
      "¿Es tu primera vez? Entrá con el link de invitación que te pasaron, o <a>creá un fondo</a>.",
    );
    expect(html(en.login.firstTime(link(en.login.createLink)))).toBe("First time here? Open the invitation link you were sent, or <a>create a fund</a>.");
    expect(html(es.home.live(link("Fútbol")))).toBe("<a>Fútbol</a>, en vivo.");
    expect(html(en.home.live(link("Fútbol")))).toBe("<a>Fútbol</a>, live.");
  });

  it("say where you stand with the amount set apart, in each language", () => {
    // React escapes the apostrophe in markup ("you&#x27;d"); the page shows it as a plain one.
    const html = (node: ReactNode) => renderToStaticMarkup(node).replaceAll("&#x27;", "'");
    const money = (text: string) => createElement("span", { className: "money" }, text);
    expect(html(es.fund.owe(money("$ 10.000")))).toBe('Debés <span class="money">$ 10.000</span>.');
    expect(html(en.fund.owe(money("ARS 10,000")))).toBe('You owe <span class="money">ARS 10,000</span>.');
    expect(html(es.fund.upToDateAhead(money("$ 2.000")))).toBe('Estás al día, con <span class="money">$ 2.000</span> adelantados.');
    expect(html(en.fund.upToDateAhead(money("ARS 2,000")))).toBe("You're up to date, <span class=\"money\">ARS 2,000</span> ahead.");
    expect(es.fund.upToDate).toBe("Estás al día.");
    expect(en.fund.upToDate).toBe("You're up to date.");
    expect(html(es.fund.share(money("$ 5.000")))).toBe('Si se cerrara hoy, te tocan <span class="money">$ 5.000</span>.');
    expect(html(en.fund.share("ARS 5,000"))).toBe("If the fund closed today, you'd get ARS 5,000.");
    expect(es.fund.inFund).toBe("En el fondo");
    expect(en.fund.inFund).toBe("In the fund");
    expect(en.panels.back).toBe("Back");
  });

  it("keep the screens' Spanish as it always was, word for word", () => {
    const html = (node: ReactNode) => renderToStaticMarkup(node).replaceAll("&#x27;", "'");
    const money = (text: string) => createElement("span", { className: "money" }, text);
    expect(es.panels.back).toBe("Volver");
    expect(es.panels.titles).toEqual({
      aportar: "Aportar",
      gasto: "Cargar un gasto",
      cuenta: "Tu cuenta",
      pesos: "Pasar a pesos",
      agente: "Agente",
      comprobante: "Comprobante",
    });
    expect(en.panels.titles).toEqual({
      aportar: "Contribute",
      gasto: "Add an expense",
      cuenta: "Your account",
      pesos: "Cash out to pesos",
      agente: "Agent",
      comprobante: "Receipt",
    });
    expect([es.nav.home, es.nav.activity, es.nav.agent, es.nav.account]).toEqual(["Inicio", "Movimientos", "Agente", "Tu cuenta"]);
    expect([en.nav.home, en.nav.activity, en.nav.agent, en.nav.account]).toEqual(["Home", "Activity", "Agent", "Your account"]);
    expect(html(es.rules.text(money("$ 60.000"), "la cancha", money("$ 55.000"), 3, 5))).toBe(
      'El agente devuelve hasta <span class="money">$ 60.000</span> por semana por la cancha. Esta semana quedan <span class="money">$ 55.000</span>. Todo lo demás necesita 3 de 5 votos. Nadie puede cambiar esto solo, ni el agente.',
    );
    expect(html(en.rules.text(money("ARS 60,000"), "la cancha", money("ARS 55,000"), 3, 5))).toBe(
      `The agent pays back up to <span class="money">ARS 60,000</span> per week for la cancha. This week's cap has <span class="money">ARS 55,000</span> left. Everything else needs 3 of 5 votes. No one can change this alone, not even the agent.`,
    );
    expect(html(es.fund.inYourAccount(money("$ 1.016,10")))).toBe('En tu cuenta tenés <span class="money">$ 1.016,10</span>.');
    expect(html(en.fund.inYourAccount(money("ARS 1,016.10")))).toBe('You have <span class="money">ARS 1,016.10</span> in your account.');
    expect(es.week.dues("$ 10.000")).toBe("Cuota de $ 10.000");
    expect(en.week.dues("ARS 10,000")).toBe("Weekly dues: ARS 10,000");
    expect(es.week.owes("$ 10.000")).toBe("debe $ 10.000");
    expect(en.week.owes("ARS 10,000")).toBe("owes ARS 10,000");
    expect([es.week.paid, en.week.paid]).toEqual(["pagó", "paid"]);
    expect(es.movements.empty).toBe("Todavía no hay movimientos. El primero puede ser tu aporte.");
    expect(es.receipt.viewOnExplorer).toBe("Ver en el explorador de Celo");
    expect(en.receipt.viewOnExplorer).toBe("View on the Celo explorer");
    expect(es.fund.publicNotice).toBe("Estás viendo un fondo real, en solo lectura.");
    expect(en.fund.publicNotice).toBe("You're looking at a real fund, read-only.");
    expect(es.account.reading).toBe("Mirando tu cuenta…");
    expect(es.account.readFailed).toBe("No pudimos mirar tu cuenta. Probamos de nuevo en unos segundos.");
    expect(en.account.reading).toBe("Looking at your account…");
    expect(en.account.readFailed).toBe("We couldn't look at your account. We'll try again in a few seconds.");
    expect(es.fundError).toEqual({
      title: "No pudimos leer el fondo en este momento.",
      moneyIsFine: "La plata está bien: es la lectura la que falló.",
      tryLater: "Probá de nuevo en un rato.",
      retrying: "Lo volvemos a intentar en unos segundos.",
      retry: "Probar de nuevo",
    });
  });

  it("shares the invitation in the language of whoever shares it", () => {
    expect(es.share.whatsApp("Fútbol", "https://tesoreria.app/invitacion/abc")).toBe('Sumate al fondo "Fútbol" en TesorerIA: https://tesoreria.app/invitacion/abc');
    expect(en.share.whatsApp("Fútbol", "https://tesoreria.app/invitacion/abc")).toBe('Join the fund "Fútbol" on TesorerIA: https://tesoreria.app/invitacion/abc');
  });
});

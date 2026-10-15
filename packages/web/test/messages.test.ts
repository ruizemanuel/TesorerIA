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

  it("shares the invitation in the language of whoever shares it", () => {
    expect(es.share.whatsApp("Fútbol", "https://tesoreria.app/invitacion/abc")).toBe('Sumate al fondo "Fútbol" en TesorerIA: https://tesoreria.app/invitacion/abc');
    expect(en.share.whatsApp("Fútbol", "https://tesoreria.app/invitacion/abc")).toBe('Join the fund "Fútbol" on TesorerIA: https://tesoreria.app/invitacion/abc');
  });
});

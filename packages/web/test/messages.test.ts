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

  it("keeps the money panels' Spanish as it always was, word for word, and says each in English", () => {
    const html = (node: ReactNode) => renderToStaticMarkup(node).replaceAll("&#x27;", "'");
    const money = (text: string) => createElement("span", { className: "money" }, text);
    // Aportar
    expect([es.contribute.haveUsdt, es.contribute.havePesos]).toEqual(["Tengo USDT", "Tengo pesos en Ripio"]);
    expect([en.contribute.haveUsdt, en.contribute.havePesos]).toEqual(["I have USDT", "I have pesos in Ripio"]);
    expect(html(es.contribute.sendAtLeast(money("6,26 USDT"), money("$ 10.000")))).toBe(
      'Mandá al menos <span class="money">6,26 USDT</span> a tu cuenta del fondo desde Binance o cualquier exchange: con eso cubrís <span class="money">$ 10.000</span> al precio de ahora.',
    );
    expect(html(es.contribute.sendAtLeastMore(money("1,26 USDT"), money("$ 10.000")))).toBe(
      'Mandá al menos <span class="money">1,26 USDT</span> más a tu cuenta del fondo desde Binance o cualquier exchange: con lo que ya tenés, cubrís <span class="money">$ 10.000</span> al precio de ahora.',
    );
    expect(html(en.contribute.sendAtLeast(money("6.26 USDT"), money("ARS 10,000")))).toBe(
      'Send at least <span class="money">6.26 USDT</span> to your fund account from Binance or any exchange: with that you cover <span class="money">ARS 10,000</span> at the current price.',
    );
    expect(html(en.contribute.sendAtLeastMore(money("1.26 USDT"), money("ARS 10,000")))).toBe(
      'Send at least <span class="money">1.26 USDT</span> more to your fund account from Binance or any exchange: with what you already have, you cover <span class="money">ARS 10,000</span> at the current price.',
    );
    expect(es.contribute.sendUsdt).toBe("Mandá USDT a tu cuenta del fondo desde Binance o cualquier exchange.");
    expect(en.contribute.sendUsdt).toBe("Send USDT to your fund account from Binance or any exchange.");
    expect(html(es.contribute.binanceMinimum(money("5 USDT")))).toBe('Si lo retirás de Binance, el mínimo es <span class="money">5 USDT</span>.');
    expect(html(es.contribute.binanceMinimumLeftover(money("5 USDT")))).toBe(
      'Si lo retirás de Binance, el mínimo es <span class="money">5 USDT</span>: lo que sobre queda en tu cuenta para la próxima.',
    );
    expect(html(en.contribute.binanceMinimum(money("5 USDT")))).toBe('If you withdraw it from Binance, the minimum is <span class="money">5 USDT</span>.');
    expect(html(en.contribute.binanceMinimumLeftover(money("5 USDT")))).toBe(
      'If you withdraw it from Binance, the minimum is <span class="money">5 USDT</span>: whatever is left over stays in your account for next time.',
    );
    expect(es.contribute.ripioWithdraw).toBe("En la app de Ripio, retirá wARS por la red Celo a tu cuenta del fondo. O cargalos directo:");
    expect(en.contribute.ripioWithdraw).toBe("In the Ripio app, withdraw wARS over the Celo network to your fund account. Or load them directly:");
    expect([es.contribute.loadWithRipio, en.contribute.loadWithRipio]).toEqual(["Cargar pesos con Ripio", "Load pesos with Ripio"]);
    expect(es.contribute.onItsWay).toBe("Tu aporte está en camino. Cuando se confirme, lo ves en el fondo.");
    expect(es.contribute.nothingYet).toBe("Todavía no llegó nada. Cuando llegue, aparece acá; puede tardar unos minutos.");
    expect(es.contribute.amountLabel).toBe("Cuánto aportás");
    expect(es.contribute.submit("10 USDT")).toBe("Aportar 10 USDT");
    expect(en.contribute.submit("ARS 10,000")).toBe("Contribute ARS 10,000");
    expect(html(es.contribute.capReachedNotice(money("$ 450.000")))).toBe('El fondo llegó a su tope de <span class="money">$ 450.000</span>: no entra más.');
    // The same sentence, said under the field as plain text and in the panel with its amount set apart.
    for (const m of [es, en]) expect(html(m.contribute.capReachedNotice("X"))).toBe(m.contribute.capReached("X"));
    expect(es.contribute.roomLeft("$ 10.000", "$ 450.000")).toBe("Al fondo le entran hasta $ 10.000 más, porque tiene un tope de $ 450.000.");
    expect(es.contribute.usdtFormat).toBe("Escribilo como 6 o 6,25.");
    expect(es.contribute.covers("$ 10.000")).toBe("Cubre los $ 10.000, al precio de ahora.");
    expect(es.contribute.worth("$ 16.000")).toBe("Son unos $ 16.000 al precio de ahora.");
    // Cargar un gasto
    expect(es.expense.which).toBe("¿Qué gasto es?");
    expect(es.expense.agreed("la cancha")).toBe("la cancha (el gasto acordado)");
    expect(en.expense.agreed("la cancha")).toBe("la cancha (the agreed expense)");
    expect([es.expense.other, en.expense.other]).toEqual(["Otro gasto (se vota)", "Other expense (voted on)"]);
    expect([es.expense.amountLabel, es.expense.noteLabel, es.expense.submit]).toEqual(["Cuánto pagaste", "Nota (opcional)", "Cargar el gasto"]);
    expect([en.expense.amountLabel, en.expense.noteLabel, en.expense.submit]).toEqual(["How much you paid", "Note (optional)", "Add the expense"]);
    expect([es.expense.amountPlaceholder, es.expense.notePlaceholder]).toEqual(["45.000", "La cancha del jueves"]);
    expect([en.expense.amountPlaceholder, en.expense.notePlaceholder]).toEqual(["45,000", "Thursday's pitch"]);
    expect(html(es.expense.twin(money("$ 5.000")))).toBe('Hace unos minutos cargaste un gasto de <span class="money">$ 5.000</span>. ¿Es otro gasto igual?');
    expect(html(en.expense.twin(money("ARS 5,000")))).toBe(
      'A few minutes ago you added an expense of <span class="money">ARS 5,000</span>. Is this another expense just like it?',
    );
    expect([es.expense.looking, es.expense.another, es.expense.same]).toEqual(["El agente lo está mirando…", "Sí, es otro", "No, es el mismo"]);
    expect([en.expense.looking, en.expense.another, en.expense.same]).toEqual(["The agent is looking at it…", "Yes, it's another one", "No, it's the same one"]);
    expect(es.errors.amountTooBig("$ 1.000.000.000.000")).toBe("No puede pasar de $ 1.000.000.000.000.");
    expect(en.errors.amountTooBig("ARS 1,000,000,000,000")).toBe("It can't be more than ARS 1,000,000,000,000.");
    // Tu cuenta
    expect(es.account.loggedInAs("Ana")).toBe("Entraste como Ana.");
    expect(en.account.loggedInAs("Ana")).toBe("You're logged in as Ana.");
    expect(html(es.account.holds(money("$ 5.000")))).toBe('En tu cuenta tenés <span class="money">$ 5.000</span>');
    expect(html(es.account.holdsAnd(money("$ 5.000"), money("10 USDT")))).toBe('En tu cuenta tenés <span class="money">$ 5.000</span> y <span class="money">10 USDT</span>');
    expect(html(en.account.holds(money("ARS 5,000")))).toBe('Your account holds <span class="money">ARS 5,000</span>');
    expect(html(en.account.holdsAnd(money("ARS 5,000"), money("10 USDT")))).toBe(
      'Your account holds <span class="money">ARS 5,000</span> and <span class="money">10 USDT</span>',
    );
    expect(html(es.account.youHave(money("$ 5.000")))).toBe('Tenés <span class="money">$ 5.000</span> en tu cuenta.');
    expect(html(en.account.youHave(money("ARS 5,000")))).toBe('You have <span class="money">ARS 5,000</span> in your account.');
    expect([es.account.reimbursementsLand, es.account.cashOut, es.account.nothingYet]).toEqual([
      "Acá llegan los reintegros del agente.",
      "Pasar a pesos con Ripio",
      "Cuando el agente te devuelva un gasto, lo vas a ver acá.",
    ]);
    expect([en.account.reimbursementsLand, en.account.cashOut, en.account.nothingYet]).toEqual([
      "This is where the agent's reimbursements arrive.",
      "Cash out to pesos with Ripio",
      "When the agent pays you back for an expense, you'll see it here.",
    ]);
    // Pasar a pesos
    expect(html(es.cashOut.passed(money("$ 2.000")))).toBe(
      'Pasaste <span class="money">$ 2.000</span> a Ripio. En un minuto lo ves en la app: ahí lo vendés 1:1 a pesos y lo pasás a tu banco.',
    );
    expect(html(en.cashOut.passed(money("ARS 2,000")))).toBe(
      'You cashed out <span class="money">ARS 2,000</span> to Ripio. In a minute you\'ll see it in the app: there you sell it 1:1 for pesos and move it to your bank.',
    );
    expect(es.cashOut.depositInstructions).toBe("En la app de Ripio tocá Depositar, elegí wARS y la red Celo, y copiá la dirección.");
    expect(en.cashOut.depositInstructions).toBe("In the Ripio app, tap Depositar (Deposit), pick wARS and the Celo network, and copy the address.");
    expect([es.cashOut.addressLabel, es.cashOut.savedAddress, es.cashOut.change]).toEqual(["Tu dirección de Ripio", "A tu cuenta de Ripio", "Cambiar"]);
    expect([en.cashOut.addressLabel, en.cashOut.savedAddress, en.cashOut.change]).toEqual(["Your Ripio address", "To your Ripio account", "Change"]);
    expect([es.cashOut.onItsWay, es.cashOut.nothingToPass, es.cashOut.amountLabel]).toEqual([
      "Tu pase a pesos está en camino.",
      "No tenés pesos en tu cuenta para pasar.",
      "Cuánto pasás",
    ]);
    expect(es.cashOut.submit).toBe("Pasar a Ripio");
    expect(es.cashOut.submitAmount("$ 2.000")).toBe("Pasar $ 2.000 a Ripio");
    expect([en.cashOut.submit, en.cashOut.submitAmount("ARS 2,000")]).toEqual(["Cash out to Ripio", "Cash out ARS 2,000 to Ripio"]);
    expect(es.cashOut.accountHolds("$ 5.000")).toBe("Tenés $ 5.000 en tu cuenta.");
    // The address and its network
    expect(es.network.warning).toBe("Elegí la red CELO. Si elegís otra, la plata se pierde.");
    expect(en.network.warning).toBe("Choose the CELO network. If you choose another, the money is lost.");
    expect([es.network.copy, es.network.copied, es.network.copiedStatus, es.network.copyFailed]).toEqual([
      "Copiar la dirección",
      "Copiada",
      "Dirección copiada.",
      "No se pudo copiar. Seleccioná la dirección y copiala.",
    ]);
    // Votar and Ejecutar
    expect([es.vote.button, en.vote.button]).toEqual(["Votar", "Vote"]);
    expect([es.execute.button, en.execute.button]).toEqual(["Ejecutar", "Carry out"]);
    // What happened to an expense
    expect(es.outcome).toEqual({
      reimbursed: "Listo: el agente te devolvió la plata.",
      proposed: "No entraba sin votación: el agente lo propuso y ahora lo vota el grupo.",
      waiting: "El fondo todavía no tiene esos pesos: el agente te lo devuelve cuando entren.",
      rejected: "El agente no puede devolver este gasto.",
      blocked: "No se pudo procesar ahora. El agente lo vuelve a intentar en un rato.",
      sending: "El agente ya lo mandó. En un rato aparece en los movimientos.",
      new: "El agente está ocupado: lo procesa en unos minutos.",
    });
  });

  it("shares the invitation in the language of whoever shares it", () => {
    expect(es.share.whatsApp("Fútbol", "https://tesoreria.app/invitacion/abc")).toBe('Sumate al fondo "Fútbol" en TesorerIA: https://tesoreria.app/invitacion/abc');
    expect(en.share.whatsApp("Fútbol", "https://tesoreria.app/invitacion/abc")).toBe('Join the fund "Fútbol" on TesorerIA: https://tesoreria.app/invitacion/abc');
  });
});

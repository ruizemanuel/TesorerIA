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
    for (const locale of LOCALES) expect(MESSAGES[locale].locale).toBe(locale);
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
      "Corre en <a>Celo mainnet</a>, con <a>la FundFactory verificada</a>, <a>el agente registrado en ERC-8004 (#9887)</a> y <a>el código abierto</a>.",
    );
    expect(judges(en)).toBe(
      "Runs on <a>Celo mainnet</a>, with <a>the verified FundFactory</a>, <a>the agent registered in ERC-8004 (#9887)</a> and <a>the open-source code</a>.",
    );
    expect(html(es.login.firstTime(link(es.login.createLink)))).toBe(
      "¿Es tu primera vez? Entrá con el link de invitación que te pasaron, o <a>creá un fondo</a>.",
    );
    expect(html(en.login.firstTime(link(en.login.createLink)))).toBe("First time here? Open the invitation link you were sent, or <a>create a fund</a>.");
    expect(html(es.home.live(link("Fútbol")))).toBe("<a>Fútbol</a>, en vivo.");
    expect(html(en.home.live(link("Fútbol")))).toBe("<a>Fútbol</a>, live.");
  });

  it("say on the portada what the agent does on its own, what takes a vote, where the money is and what happens if you leave", () => {
    // React escapes the apostrophe in markup ("fund&#x27;s"); the page shows it as a plain one.
    const html = (node: ReactNode) => renderToStaticMarkup(node).replaceAll("&#x27;", "'");
    const money = (text: string) => createElement("span", { className: "money" }, text);
    const link = (text: string) => createElement("a", null, text);
    expect(es.home.rules.title).toBe("Qué hace el agente solo y qué se vota");
    expect(en.home.rules.title).toBe("What the agent does on its own, and what takes a vote");
    expect(html(es.home.rules.alone("la cancha", money(`$${NBSP}60.000`)))).toBe(
      `Solo, el agente pasa a pesos los USDT que entran y devuelve la cancha hasta <span class="money">$${NBSP}60.000</span> por semana, siempre a un miembro.`,
    );
    // In English, what the group wrote goes in quotes: it stays in Spanish.
    expect(html(en.home.rules.alone("la cancha", money(`ARS${NBSP}60,000`)))).toBe(
      `On its own, the agent converts the USDT that comes in to pesos, and pays back “la cancha” up to <span class="money">ARS${NBSP}60,000</span> a week, always to a member.`,
    );
    expect(es.home.rules.vote("Fútbol de los jueves", 5, 8)).toBe(
      "Todo lo demás se vota: otro pago, sumar o sacar a alguien, cambiar el tope o el agente, cerrar el fondo. En Fútbol de los jueves hacen falta 5 de 8 votos.",
    );
    expect(en.home.rules.vote("Fútbol de los jueves", 5, 8)).toBe(
      "Everything else takes a vote: any other payment, adding or removing someone, changing the cap or the agent, closing the fund. In Fútbol de los jueves, it takes 5 of 8 votes.",
    );
    expect(html(es.home.rules.money(link(es.home.rules.contractLink)))).toBe(
      "La plata está en <a>el contrato del propio fondo</a>, no en una cuenta nuestra, y nadie puede cambiar estas reglas solo.",
    );
    expect(html(en.home.rules.money(link(en.home.rules.contractLink)))).toBe(
      "The money sits in <a>the fund's own contract</a>, not in an account of ours, and no one can change these rules alone.",
    );
    expect(es.home.rules.leaving).toBe(
      "Si te vas, el grupo vota tu salida y te llevás tu parte de lo que hay en el fondo, en proporción a lo que aportaste. Si se cierra, se reparte todo igual entre los que quedan.",
    );
    expect(en.home.rules.leaving).toBe(
      "If you leave, the group votes you out and you take your share of what's in the fund, in proportion to what you put in. If it closes, it's all split the same way among those still in it.",
    );
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
      resumen: "Resumen de la semana",
    });
    expect(en.panels.titles).toEqual({
      aportar: "Contribute",
      gasto: "Add an expense",
      cuenta: "Your account",
      pesos: "Cash out to pesos",
      agente: "Agent",
      comprobante: "Receipt",
      resumen: "Week summary",
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
    expect(es.week.owes("$ 10.000")).toBe("debe en total $ 10.000");
    expect(en.week.owes("ARS 10,000")).toBe("owes ARS 10,000 in total");
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
    // Beside the label, in the amount's box: what the account holds, short.
    expect(html(es.contribute.youHold(money("6,18 USDT")))).toBe('Tenés <span class="money">6,18 USDT</span>');
    expect(html(en.contribute.youHold(money("6.18 USDT")))).toBe('You have <span class="money">6.18 USDT</span>');
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

  it("keeps the chat's Spanish as it always was, word for word, and says each in English", () => {
    // What the route answers, the panel and the card (texts.ts, chat-panel.tsx, expense-proposal-card.tsx, view.ts).
    expect({
      unavailable: es.chat.unavailable,
      memberLimit: es.chat.memberLimit,
      refused: es.chat.refused,
      badCard: es.chat.badCard,
      sendFailed: es.chat.sendFailed,
      longMessage: es.chat.longMessage(500),
      badRequest: es.chat.badRequest,
      notFound: es.chat.notFound,
    }).toEqual({
      unavailable: "El agente no puede responder ahora. Probá más tarde.",
      memberLimit: "Por hoy ya hablamos bastante. Mañana seguimos.",
      refused: "No puedo ayudarte con eso.",
      badCard: "No pude armar el gasto. Contame de nuevo el monto y qué fue.",
      sendFailed: "No pudimos mandar tu mensaje.",
      longMessage: "Tu mensaje puede tener hasta 500 letras.",
      badRequest: "Faltan datos o no son válidos.",
      notFound: "No encontramos ese fondo.",
    });
    expect({
      unavailable: en.chat.unavailable,
      memberLimit: en.chat.memberLimit,
      refused: en.chat.refused,
      badCard: en.chat.badCard,
      sendFailed: en.chat.sendFailed,
      longMessage: en.chat.longMessage(500),
      badRequest: en.chat.badRequest,
      notFound: en.chat.notFound,
    }).toEqual({
      unavailable: "The agent can't answer right now. Try again later.",
      memberLimit: "We've talked enough for today. We'll pick this up tomorrow.",
      refused: "I can't help you with that.",
      badCard: "I couldn't put the expense together. Tell me the amount and what it was for again.",
      sendFailed: "We couldn't send your message.",
      longMessage: "Your message can be up to 500 characters.",
      badRequest: en.errors.badRequest,
      notFound: en.errors.fundNotFound,
    });
    // The route answers with the dictionary's other words where it doesn't have the chat's: the same sentences.
    expect(es.chat.badRequest).toBe(es.errors.badRequest);
    expect(es.chat.notFound).toBe(es.errors.fundNotFound);
    expect([es.chat.remaining(1), es.chat.remaining(5)]).toEqual(["Te queda 1 mensaje por hoy.", "Te quedan 5 mensajes por hoy."]);
    expect([en.chat.remaining(1), en.chat.remaining(5)]).toEqual(["You have 1 message left today.", "You have 5 messages left today."]);
    expect([es.chat.greeting("Ana"), en.chat.greeting("Ana")]).toEqual(["Hola, Ana. Preguntame lo que quieras del fondo.", "Hi, Ana. Ask me anything about the fund."]);
    expect(es.chat.suggestions).toEqual(["¿Quién debe esta semana?", "¿Cuánto queda del tope de la semana?", "Quiero cargar un gasto"]);
    expect(en.chat.suggestions).toEqual(["Who owes this week?", "How much is left of the weekly cap?", "I want to add an expense"]);
    expect([es.chat.typing, es.chat.questionLabel, es.chat.placeholder, es.chat.send, es.chat.count(12, 500)]).toEqual([
      "El agente está escribiendo",
      "Tu pregunta",
      "Escribí tu pregunta",
      "Enviar",
      "12 de 500",
    ]);
    expect([en.chat.typing, en.chat.questionLabel, en.chat.placeholder, en.chat.send, en.chat.count(12, 500)]).toEqual([
      "The agent is typing",
      "Your question",
      "Write your question",
      "Send",
      "12 of 500",
    ]);
    // The card.
    expect(es.chat.card.agreedNext("$ 15.000")).toBe("Si entra en lo que queda del tope de la semana ($ 15.000), te lo devuelvo enseguida. Si no, se vota.");
    expect(en.chat.card.agreedNext("ARS 15,000")).toBe("If it fits in what's left of the weekly cap (ARS 15,000), I'll pay you back right away. If not, it goes to a vote.");
    expect([es.chat.card.otherNext(3, 5), en.chat.card.otherNext(3, 5)]).toEqual(["Se vota: necesita 3 de 5 votos.", "It goes to a vote: it needs 3 of 5 votes."]);
    expect([es.chat.card.otherExpense, es.chat.card.kindLabel, es.chat.card.amountLabel, es.chat.card.noteLabel]).toEqual([
      "Otro gasto",
      "Qué gasto es",
      "Cuánto",
      "Nota",
    ]);
    expect([en.chat.card.otherExpense, en.chat.card.kindLabel, en.chat.card.amountLabel, en.chat.card.noteLabel]).toEqual([
      "Other expense",
      "Which expense it is",
      "How much",
      "Note",
    ]);
    expect([es.chat.card.confirm, es.chat.card.cancel, es.chat.card.notLoaded]).toEqual(["Confirmar", "Cancelar", "No lo cargué."]);
    expect([en.chat.card.confirm, en.chat.card.cancel, en.chat.card.notLoaded]).toEqual(["Confirm", "Cancel", "I didn't add it."]);
  });

  it("keeps the chat brief's Spanish as it always was, word for word, and says each in English", () => {
    const [s, e] = [es.chat.brief, en.chat.brief];
    expect([s.agent, s.group, s.account, s.youVoted, s.closed]).toEqual(["El agente", "El grupo", "una cuenta", " Ya la votaste.", " El fondo está cerrado."]);
    expect([e.agent, e.group, e.account, e.youVoted, e.closed]).toEqual(["The agent", "The group", "an account", " You already voted on it.", " The fund is closed."]);
    expect([s.reason("X"), e.reason("X")]).toEqual([" Motivo: X", " Reason: X"]);
    expect(s.now("sábado", "3")).toBe("Ahora es sábado, hora de Argentina. El fondo va por su semana 3.");
    expect(e.now("Saturday", "3")).toBe("It's Saturday, Argentina time. The fund is in week 3.");
    expect([s.fund("Fútbol", "$ 80.000"), e.fund("Football", "ARS 80,000")]).toEqual(["Fondo: Fútbol. Saldo: $ 80.000.", "Fund: Football. Balance: ARS 80,000."]);
    expect(s.rules("$ 10.000", "$ 60.000", "la cancha", "$ 45.000", "$ 15.000", 2, 3)).toBe(
      "Reglas: cada uno pone $ 10.000 por semana. El agente devuelve hasta $ 60.000 por semana por la cancha, el gasto acordado: esta semana devolvió $ 45.000 y quedan $ 15.000. Todo lo demás necesita 2 de 3 votos. Nadie puede cambiar esto solo, ni el agente.",
    );
    expect(e.rules("ARS 10,000", "ARS 60,000", "the pitch", "ARS 45,000", "ARS 15,000", 2, 3)).toBe(
      "Rules: each person puts in ARS 10,000 per week. The agent pays back up to ARS 60,000 per week for the pitch, the agreed expense: this week it has paid back ARS 45,000 and ARS 15,000 is left. Everything else needs 2 of 3 votes. No one can change this alone, not even the agent.",
    );
    expect([s.speaking("Ana"), e.speaking("Ana")]).toEqual(["Te habla: Ana.", "Who's asking: Ana."]);
    expect([s.owe("$ 10.000"), s.upToDateAhead("$ 2.000"), s.upToDate]).toEqual(["Debés $ 10.000.", "Estás al día, con $ 2.000 adelantados.", "Estás al día."]);
    expect([e.owe("ARS 10,000"), e.upToDateAhead("ARS 2,000"), e.upToDate]).toEqual(["You owe ARS 10,000.", "You're up to date, ARS 2,000 ahead.", "You're up to date."]);
    expect(s.situation("Estás al día.", "$ 5.000")).toBe("Tu situación: Estás al día. Si el fondo se cerrara hoy, te tocarían $ 5.000.");
    expect(e.situation("You're up to date.", "ARS 5,000")).toBe("Your situation: You're up to date. If the fund closed today, you'd get ARS 5,000.");
    expect([s.weekList, s.noProposals, s.proposals, s.noMovements, s.movements]).toEqual([
      "La lista de la semana, en el orden en que entraron:",
      "Propuestas abiertas: ninguna.",
      "Propuestas abiertas:",
      "Movimientos: todavía no hay.",
      "Movimientos, del más nuevo al más viejo:",
    ]);
    expect([e.weekList, e.noProposals, e.proposals, e.noMovements, e.movements]).toEqual([
      "This week's list, in the order they joined:",
      "Open proposals: none.",
      "Open proposals:",
      "Activity: none yet.",
      "Activity, newest first:",
    ]);
    expect(s.movementsCut(50, 60)).toBe("Movimientos, del más nuevo al más viejo (los 50 más nuevos de 60; los anteriores no los ves):");
    expect(e.movementsCut(50, 60)).toBe("Activity, newest first (the newest 50 of 60; you can't see the older ones):");
  });

  it("ask a member to update their passkey, in each language", () => {
    const sentences = (m: typeof es) => [
      m.keyChange.title,
      m.keyChange.lead,
      m.keyChange.twice,
      m.keyChange.button,
      m.keyChange.resume,
      m.keyChange.later,
      m.keyChange.working,
      ...Object.values(m.keyChange.step),
      m.keyChange.waiting,
      m.keyChange.done,
    ];
    expect(Object.keys(es.keyChange.step)).toEqual(["create", "prove", "sign", "confirm"]);
    for (const m of [es, en]) {
      for (const sentence of sentences(m)) expect(sentence).toMatch(/\S/);
      expect(m.keyChange.lead).toContain("tesoreria.finance");
    }
    // The word is passkey, as everywhere else in the interface.
    for (const sentence of sentences(es)) expect(sentence).not.toMatch(/llave/i);
    expect(sentences(es)).not.toEqual(sentences(en));
  });

  it("shares the invitation in the language of whoever shares it", () => {
    expect(es.share.whatsApp("Fútbol", "https://tesoreria.app/invitacion/abc")).toBe('Sumate al fondo "Fútbol" en TesorerIA: https://tesoreria.app/invitacion/abc');
    expect(en.share.whatsApp("Fútbol", "https://tesoreria.app/invitacion/abc")).toBe('Join the fund "Fútbol" on TesorerIA: https://tesoreria.app/invitacion/abc');
  });
});

// packages/web/scripts/i18n-table.ts
// Writes i18n-table.html: every sentence of the web in Spanish and in English, side by side, for a person to read
// through before a push (spec, 9.3). Not committed.
//
// A sentence with values is a function, so each one has realistic arguments in ARGS below, in its own parameter
// order and type, written in each language's format (the same name, the same amount). A function with a branch
// (plural, optional note) has a case per branch. The script fails if a function has no entry, if an entry has the
// wrong number of arguments, or if any cell comes out with "undefined", "NaN", "[object" or "function" in it, so a
// change to the dictionaries can't leave the table silently wrong.
import { writeFileSync } from "node:fs";
import { createElement, Fragment, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatPesos, formatUsdt, formatWhen, intlLocale, TIME_ZONE, USDT_UNIT, WARS_UNIT } from "../src/lib/format";
import { en } from "../src/lib/i18n/en";
import { es, type Messages } from "../src/lib/i18n/es";
import type { Locale } from "../src/lib/i18n/locales";

const CENT = WARS_UNIT / 100n;
const BROKEN = /undefined|NaN|\[object|function/;

/** What an example is made of, in one language: its dictionary, and the names and amounts the examples share. */
interface Kit {
  m: Messages;
  locale: Locale;
  /** The amount in pesos, as the screen writes it ("$ 10.000", "ARS 10,000"). */
  pesos(amount: number): string;
  usdt(amount: number): string;
  /** A part that stands out on screen: the dictionary takes it as a ReactNode. */
  bold(text: string): ReactElement;
  /** A link on screen. */
  link(text: string): ReactElement;
  /** What the creator wrote, as the form starts with it: the fund's name, the agreed expense, a note. */
  fund: string;
  expense: string;
  note: string;
}

function kitFor(m: Messages): Kit {
  return {
    m,
    locale: m.locale,
    pesos: (amount) => formatPesos(BigInt(Math.round(amount * 100)) * CENT, m.locale),
    usdt: (amount) => formatUsdt(BigInt(Math.round(amount * 1_000_000)), m.locale),
    bold: (text) => createElement("b", null, text),
    link: (text) => createElement("u", null, text),
    fund: m.create.defaults.fundNamePlaceholder,
    expense: m.create.defaults.agreedExpense,
    note: m.locale === "es" ? "la pelota nueva" : "the new ball",
  };
}

const KITS = { es: kitFor(es), en: kitFor(en) };

interface Case {
  /** Which branch this is, when a function has more than one. */
  when?: string;
  args: unknown[];
}
const call = (...args: unknown[]): Case => ({ args });
const when = (label: string, ...args: unknown[]): Case => ({ when: label, args });

/** A Thursday, 10:15 in Buenos Aires. */
const NOW = new Date("2026-10-15T13:15:00Z");
const NAME = "Ana";
const OTHER = "Beto";
const THIRD = "Caro";
const INVITATION_URL = "https://tesoreria.example/invitacion/k3x9";

/** Realistic arguments for every function of the dictionaries, by its path. */
const ARGS: Record<string, (k: Kit) => Case[]> = {
  "common.member": () => [call(3)],
  "errors.amountTooBig": ({ pesos }) => [call(pesos(1_000_000_000_000))],
  "checks.feeTooBig": ({ pesos }) => [call(pesos(1_000_000_000_000))],
  "checks.capTooBig": ({ pesos }) => [call(pesos(1_000_000_000_000))],
  "funds.accountCap": () => [call(3)],
  "funds.tooManyMembers": () => [call(10, 11)],
  "funds.votesRange": () => [call(8)],
  "funds.votesLocked": () => [call(5)],
  "expenses.amountTooBig": ({ pesos }) => [call(pesos(1_000_000_000_000))],
  "expenses.noteTooLong": () => [call(140)],
  "home.live": ({ bold, fund }) => [call(bold(fund))],
  "home.judges": ({ m, link }) => [
    call(link(m.home.judgesLinks.celo), link(m.home.judgesLinks.contract), link(m.home.judgesLinks.agent), link(m.home.judgesLinks.code)),
  ],
  "login.firstTime": ({ m, link }) => [call(link(m.login.createLink))],
  "deploy.waitingForCreator": () => [call(NAME)],
  "deploy.votesOption": () => [call(5, 8)],
  "share.whatsApp": ({ fund }) => [call(fund, INVITATION_URL)],
  "invitation.title": ({ fund }) => [call(NAME, createElement("i", null, fund))],
  "invitation.rules": ({ bold, pesos, expense }) => [call(bold(pesos(10_000)), bold(pesos(60_000)), expense)],
  "invitation.alreadyJoined": () => [call(`${NAME}, ${OTHER}, ${THIRD}`)],
  "timeline.contributed": ({ m, pesos }) => [call(NAME, pesos(10_000)), when("an account with no name", m.timeline.someone, pesos(10_000))],
  "timeline.converted": ({ pesos, usdt }) => [call(usdt(10), pesos(16_000))],
  "timeline.reimbursed": ({ pesos, expense }) => [call(pesos(45_000), NAME, expense)],
  "timeline.reimbursedLeftThisWeek": ({ pesos }) => [call(pesos(15_000))],
  "timeline.reimbursedLeftThatWeek": ({ pesos }) => [call(pesos(15_000))],
  "timeline.reimbursedDetail": ({ expense, pesos }) => [call(expense, pesos(60_000))],
  "timeline.proposal.byAgent": ({ m, pesos, note }) => [call(m.timeline.proposal.pay(pesos(3_000), THIRD, note))],
  "timeline.proposal.byMember": ({ m }) => [
    call(OTHER, m.timeline.proposal.removeMember(THIRD)),
    when("an account with no name", m.timeline.someone, m.timeline.proposal.removeMember(THIRD)),
  ],
  "timeline.proposal.agentDetail": () => [call(5)],
  "timeline.proposal.pay": ({ pesos, note }) => [when("with a note", pesos(3_000), THIRD, note), when("without a note", pesos(3_000), THIRD, "")],
  "timeline.proposal.removeMember": () => [call(THIRD)],
  "timeline.proposal.replaceMember": () => [call(THIRD)],
  "timeline.proposal.setWeeklyCap": ({ expense, pesos }) => [call(expense, pesos(80_000))],
  "timeline.proposal.setVotesRequired": ({ expense }) => [call(5, expense)],
  "timeline.proposal.short": ({ pesos }) => [call(pesos(3_000))],
  "timeline.proposal.votes": () => [call(3, 5)],
  "timeline.paid": ({ pesos }) => [call(pesos(3_000), NAME)],
  "timeline.memberAdded": () => [call(THIRD)],
  "timeline.memberRemoved": ({ m }) => [call(THIRD), when("an account with no name", m.timeline.someone)],
  "timeline.memberReplaced": ({ m }) => [call(THIRD), when("an account with no name", m.timeline.someone)],
  "timeline.weeklyCapChanged": ({ expense, pesos }) => [call(expense, pesos(80_000))],
  "timeline.votesRequiredChanged": ({ expense }) => [call(5, expense)],
  "timeline.hold": ({ m, usdt }) => [call(usdt(10), m.timeline.holdWhy["price-reference"])],
  "timeline.expense.what": ({ pesos, note }) => [
    when("with a note", pesos(45_000), NAME, note),
    when("without a note", pesos(45_000), NAME, ""),
  ],
  "timeline.expense.looking": ({ m, pesos, note }) => [call(m.timeline.expense.what(pesos(45_000), NAME, note))],
  "timeline.expense.waiting": ({ m, pesos, note }) => [call(m.timeline.expense.what(pesos(45_000), NAME, note))],
  "timeline.expense.blocked": ({ m, pesos, note }) => [call(m.timeline.expense.what(pesos(45_000), NAME, note))],
  "timeline.expense.rejected": ({ m, pesos, note }) => [call(m.timeline.expense.what(pesos(45_000), NAME, note))],
  "timeline.onItsWay.contribution": ({ pesos }) => [call(pesos(10_000))],
  "fund.owe": ({ bold, pesos }) => [call(bold(pesos(10_000)))],
  "fund.upToDateAhead": ({ bold, pesos }) => [call(bold(pesos(20_000)))],
  "fund.share": ({ bold, pesos }) => [call(bold(pesos(8_000)))],
  "fund.inYourAccount": ({ m, bold, pesos, usdt }) => [call(createElement(Fragment, null, bold(pesos(1_016.1)), ` ${m.fund.and} `, bold(usdt(5))))],
  "week.dues": ({ pesos }) => [call(pesos(10_000))],
  "week.owes": ({ pesos }) => [call(pesos(10_000))],
  "rules.text": ({ bold, pesos, expense }) => [call(bold(pesos(60_000)), expense, bold(pesos(45_000)), 5, 8)],
  "account.youHave": ({ bold, pesos }) => [call(bold(pesos(1_016.1)))],
  "account.loggedInAs": () => [call(NAME)],
  "account.holds": ({ bold, pesos }) => [call(bold(pesos(1_016.1)))],
  "account.holdsAnd": ({ bold, pesos, usdt }) => [call(bold(pesos(1_016.1)), bold(usdt(5)))],
  "contribute.sendAtLeast": ({ bold, pesos, usdt }) => [call(bold(usdt(6.26)), bold(pesos(10_000)))],
  "contribute.sendAtLeastMore": ({ bold, pesos, usdt }) => [call(bold(usdt(2.5)), bold(pesos(10_000)))],
  "contribute.binanceMinimum": ({ bold, usdt }) => [call(bold(usdt(5)))],
  "contribute.binanceMinimumLeftover": ({ bold, usdt }) => [call(bold(usdt(5)))],
  "contribute.capReachedNotice": ({ bold, pesos }) => [call(bold(pesos(450_000)))],
  "contribute.submit": ({ pesos }) => [call(pesos(10_000))],
  "contribute.accountHolds": ({ pesos }) => [call(pesos(1_016.1))],
  "contribute.capReached": ({ pesos }) => [call(pesos(450_000))],
  "contribute.roomLeft": ({ pesos }) => [call(pesos(10_000), pesos(450_000))],
  "contribute.covers": ({ pesos }) => [call(pesos(10_000))],
  "contribute.worth": ({ pesos }) => [call(pesos(16_000))],
  "expense.agreed": ({ expense }) => [call(expense)],
  "expense.twin": ({ bold, pesos }) => [call(bold(pesos(45_000)))],
  "cashOut.passed": ({ bold, pesos }) => [call(bold(pesos(45_000)))],
  "cashOut.submitAmount": ({ pesos }) => [call(pesos(45_000))],
  "cashOut.accountHolds": ({ pesos }) => [call(pesos(45_000))],
  "chat.longMessage": () => [call(500)],
  "chat.remaining": () => [when("several left", 3), when("one left", 1)],
  "chat.greeting": () => [call(NAME)],
  "chat.count": () => [call(420, 500)],
  "chat.card.agreedNext": ({ pesos }) => [call(pesos(15_000))],
  "chat.card.otherNext": () => [call(5, 8)],
  "chat.brief.reason": ({ m }) => [call(m.timeline.proposal.agentDetail(5))],
  "chat.brief.now": ({ locale }) => [
    call(
      new Intl.DateTimeFormat(intlLocale(locale), {
        timeZone: TIME_ZONE,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(NOW),
      "3",
    ),
  ],
  "chat.brief.fund": ({ fund, pesos }) => [call(fund, pesos(80_000))],
  "chat.brief.rules": ({ pesos, expense }) => [call(pesos(10_000), pesos(60_000), expense, pesos(45_000), pesos(15_000), 5, 8)],
  "chat.brief.speaking": () => [call(NAME)],
  "chat.brief.owe": ({ pesos }) => [call(pesos(10_000))],
  "chat.brief.upToDateAhead": ({ pesos }) => [call(pesos(20_000))],
  "chat.brief.situation": ({ m, pesos }) => [
    when("owing", m.chat.brief.owe(pesos(10_000)), pesos(8_000)),
    when("ahead", m.chat.brief.upToDateAhead(pesos(20_000)), pesos(8_000)),
    when("up to date", m.chat.brief.upToDate, pesos(8_000)),
  ],
  "chat.brief.movementsCut": () => [call(50, 85)],
};

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** A plain string is escaped; what a function returned as React is rendered, and goes in as the HTML it is. */
function html(value: unknown, where: string): string {
  const text = isValidElement(value) ? renderToStaticMarkup(value) : typeof value === "string" ? escape(value) : null;
  if (text === null) throw new Error(`${where}: not a sentence: ${String(value)}`);
  if (BROKEN.test(text)) throw new Error(`${where}: broken cell: ${text}`);
  return text;
}

const used = new Set<string>();

function said(spanish: unknown, english: unknown, path: string): string[] {
  const row = (label: string, es: string, en: string) => `<tr><td>${label}</td><td>${es}</td><td>${en}</td></tr>`;
  if (typeof spanish === "function" && typeof english === "function") {
    const entry = ARGS[path];
    if (entry === undefined) throw new Error(`${path}: no example arguments in scripts/i18n-table.ts`);
    used.add(path);
    const inSpanish = entry(KITS.es);
    const inEnglish = entry(KITS.en);
    if (inSpanish.length === 0 || inSpanish.length !== inEnglish.length) throw new Error(`${path}: Spanish and English need the same cases`);
    return inSpanish.map((spanishCase, i) => {
      const englishCase = inEnglish[i] as Case;
      for (const [fn, args] of [[spanish, spanishCase.args], [english, englishCase.args]] as const) {
        if (fn.length !== args.length) throw new Error(`${path}: takes ${fn.length} arguments, the example has ${args.length}`);
      }
      const label = spanishCase.when === undefined ? path : `${path} (${spanishCase.when})`;
      return row(
        label,
        html(spanish(...spanishCase.args), `${label} (es)`),
        html(english(...englishCase.args), `${label} (en)`),
      );
    });
  }
  if (Array.isArray(spanish) && Array.isArray(english)) {
    const lines = (list: unknown[], language: string) => list.map((line) => html(line, `${path} (${language})`)).join("<br>");
    return [row(path, lines(spanish, "es"), lines(english, "en"))];
  }
  if (typeof spanish === "string" && typeof english === "string") return [row(path, html(spanish, `${path} (es)`), html(english, `${path} (en)`))];
  if (typeof spanish === "object" && spanish !== null && typeof english === "object" && english !== null) {
    return Object.keys(spanish).flatMap((key) => {
      if (path === "" && key === "locale") return [];
      return said((spanish as Record<string, unknown>)[key], (english as Record<string, unknown>)[key], path === "" ? key : `${path}.${key}`);
    });
  }
  throw new Error(`${path}: Spanish and English don't have the same shape`);
}

const sentences = said(es, en, "");
const stale = Object.keys(ARGS).filter((path) => !used.has(path));
if (stale.length > 0) throw new Error(`Example arguments for functions that aren't in the dictionaries: ${stale.join(", ")}`);

/** The formats, from the functions the screens use. */
const FORMATS: Array<[label: string, write: (locale: Locale) => string]> = [
  ["formatPesos, whole", (l) => formatPesos(10_000n * WARS_UNIT, l)],
  ["formatPesos, with cents", (l) => formatPesos(1_605_037n * CENT, l)],
  ["formatPesos, millions", (l) => formatPesos(1_234_567n * WARS_UNIT, l)],
  ["formatUsdt, whole", (l) => formatUsdt(10n * USDT_UNIT, l)],
  ["formatUsdt, with decimals", (l) => formatUsdt(10_500_000n, l)],
  ["formatWhen, today", (l) => formatWhen(new Date("2026-10-15T13:15:00Z"), NOW, l)],
  ["formatWhen, yesterday", (l) => formatWhen(new Date("2026-10-14T21:02:00Z"), NOW, l)],
  ["formatWhen, this week", (l) => formatWhen(new Date("2026-10-12T12:00:00Z"), NOW, l)],
  ["formatWhen, older", (l) => formatWhen(new Date("2026-10-03T12:00:00Z"), NOW, l)],
];
const formats = FORMATS.map(([label, write]) => {
  const [spanish, english] = [write("es"), write("en")].map((text, i) => html(text, `${label} (${i === 0 ? "es" : "en"})`));
  return `<tr><td>${label}</td><td>${spanish}</td><td>${english}</td></tr>`;
});

const head = (first: string) => `<tr><th>${first}</th><th>castellano</th><th>inglés</th></tr>`;
const page = `<!doctype html><meta charset="utf-8"><title>TesorerIA: castellano | inglés</title>
<style>body{font:15px system-ui;margin:24px}table{border-collapse:collapse;margin-bottom:32px}td{border:1px solid #ccc;padding:6px 8px;vertical-align:top;white-space:pre-wrap}td:first-child{color:#777;font:12px monospace}th{text-align:left;padding:6px 8px}</style>
<p>Los nombres, los montos y los gastos son ejemplos (cada idioma los escribe a su manera). En negrita, lo que resalta en pantalla. Las frases con variantes (plural, con o sin nota) tienen una fila por variante.</p>
<h2>Formatos</h2>
<table>${head("formato")}${formats.join("\n")}</table>
<h2>Frases</h2>
<table>${head("clave")}${sentences.join("\n")}</table>`;
writeFileSync(new URL("../i18n-table.html", import.meta.url), page);
console.log(`i18n-table.html written: ${sentences.length} sentences, ${formats.length} formats`);

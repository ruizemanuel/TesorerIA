import { USDT, WARS as WARS_TOKEN } from "@tesoreria/agent";
import { type Address, getAddress, pad, toHex, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import type { ExpenseStatus } from "../src/lib/db/schema";
import { NBSP, formatUsdt } from "../src/lib/format";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { type ProposalState, buildTimeline } from "../src/lib/timeline";
import { AGENT, ANA, BETO, BLOCK, CARO, CLOCK, NOW, START, USDT_UNIT, WARS, event } from "./support/fixtures";

const NAMES = new Map<Address, string>([
  [ANA, "Ana"],
  [BETO, "Beto"],
  [CARO, "Caro"],
]);

function timeline(change: Partial<Parameters<typeof buildTimeline>[0]> = {}) {
  return buildTimeline({
    events: [],
    clock: CLOCK,
    agent: AGENT,
    names: NAMES,
    agreedExpense: "la cancha",
    initialWeeklyCap: 60_000n * WARS,
    startTime: START,
    votesRequired: 2,
    memberCount: 3,
    proposals: new Map(),
    expenses: [],
    pending: [],
    conversionHold: null,
    warsBalance: 90_000n * WARS,
    viewerIsMember: true,
    now: NOW,
    m: es,
    ...change,
  });
}

const $ = (text: string) => text.replaceAll("$ ", `$${NBSP}`).replaceAll(" USDT", `${NBSP}USDT`);

describe("buildTimeline", () => {
  it("tells contributions, a conversion and a reimbursement in Spanish, newest first, the agent in first person", () => {
    const items = timeline({
      events: [
        event("Contribution", { member: BETO, token: USDT, amount: 10n * USDT_UNIT, creditedWars: 16_070n * WARS }, BLOCK - 600n),
        event("Conversion", { usdtIn: 10n * USDT_UNIT, warsOut: 16_050n * WARS }, BLOCK - 500n),
        event("Contribution", { member: ANA, token: WARS_TOKEN, amount: 10_000n * WARS, creditedWars: 10_000n * WARS }, BLOCK - 400n),
        event("Reimbursement", { member: ANA, amount: 45_000n * WARS, ref: pad("0x01", { size: 32 }), week: 2n }, BLOCK - 300n),
      ],
    });
    expect(items.map((i) => [i.actor, i.text])).toEqual([
      [{ kind: "agent" }, $("Le devolví $ 45.000 a Ana por la cancha. Quedan $ 15.000 del tope de esta semana.")],
      [{ kind: "member", name: "Ana" }, $("Ana aportó $ 10.000.")],
      [{ kind: "agent" }, $("Pasé a pesos los 10 USDT que entraron: $ 16.050.")],
      [{ kind: "member", name: "Beto" }, $("Beto aportó 10 USDT.")],
    ]);
    expect(items[0]?.at).toEqual(new Date(NOW.getTime() - 300_000));
    expect(items[0]?.action).toEqual({ kind: "receipt", tx: pad(toHex(Number((BLOCK - 300n) % 100_000n)), { size: 32 }) });
    expect(items[0]?.detail).toBe($("Era la cancha, que devuelvo sin votación hasta $ 60.000 por semana."));
  });

  it("explains the conversion in plain words, without naming the exchange or the price feed (spec, 9)", () => {
    const [conversion] = timeline({ events: [event("Conversion", { usdtIn: 10n * USDT_UNIT, warsOut: 16_050n * WARS }, BLOCK - 500n)] });
    expect(conversion?.detail).toBeTruthy();
    expect(conversion?.detail).not.toMatch(/\b(uniswap|chainlink|oracle|pool|gas|hash|wallet|blockchain|token)\b/i);
  });

  it("uses the weekly cap that held at the time, and says 'esa semana' for an older week", () => {
    const items = timeline({
      events: [
        event("Reimbursement", { member: ANA, amount: 20_000n * WARS, ref: pad("0x01", { size: 32 }), week: 1n }, BLOCK - 700_000n),
        event("WeeklyCapChanged", { cap: 80_000n * WARS }, BLOCK - 600_000n),
        event("Reimbursement", { member: BETO, amount: 50_000n * WARS, ref: pad("0x02", { size: 32 }), week: 2n }, BLOCK - 100n),
      ],
    });
    expect(items.map((i) => i.text)).toEqual([
      $("Le devolví $ 50.000 a Beto por la cancha. Quedan $ 30.000 del tope de esta semana."),
      $("El tope semanal de la cancha ahora es $ 80.000."),
      $("Le devolví $ 20.000 a Ana por la cancha. Quedaban $ 40.000 del tope de esa semana."),
    ]);
  });

  it("shows a proposal with its votes, and lets vote only a member who hasn't", () => {
    const proposal = event(
      "ProposalCreated",
      { id: 0n, action: 0, a: CARO, b: zeroAddress, amount: 30_000n * WARS, proposer: AGENT, note: "la pelota nueva" },
      BLOCK - 100n,
    );
    const at = (state: ProposalState, viewerIsMember = true) =>
      timeline({ events: [proposal], proposals: new Map([[0n, state]]), viewerIsMember })[0];
    const open = { votes: 1, executed: false, deadline: CLOCK.timestamp + 86_400n, voted: false };
    expect(at(open)).toMatchObject({
      actor: { kind: "agent" },
      text: $("Propuse pagarle $ 30.000 a Caro por la pelota nueva. Lleva 1 de 2 votos."),
      action: { kind: "vote", proposalId: 0n, votes: 1, required: 2, canVote: true, voted: false, completes: true },
    });
    expect(at({ ...open, voted: true })?.action).toMatchObject({ canVote: false, voted: true });
    expect(at(open, false)?.action).toMatchObject({ canVote: false });
    expect(at({ ...open, votes: 2, executed: true })).toMatchObject({ text: $("Propuse pagarle $ 30.000 a Caro por la pelota nueva. Se aprobó.") });
    expect(at({ ...open, deadline: CLOCK.timestamp - 1n })?.text).toBe(
      $("Propuse pagarle $ 30.000 a Caro por la pelota nueva. Venció sin los votos necesarios."),
    );
    const byBeto = event(
      "ProposalCreated",
      { id: 1n, action: 7, a: zeroAddress, b: zeroAddress, amount: 0n, proposer: BETO, note: "" },
      BLOCK - 50n,
    );
    const closing = timeline({ events: [byBeto], proposals: new Map([[1n, open]]) })[0];
    expect(closing).toMatchObject({ actor: { kind: "member", name: "Beto" }, text: "Beto propuso cerrar el fondo y repartir el saldo. Lleva 1 de 2 votos." });
  });

  it("offers Ejecutar on a proposal with its votes that didn't run, unless the fund can't pay it yet or it expired", () => {
    const proposal = event(
      "ProposalCreated",
      { id: 0n, action: 0, a: CARO, b: zeroAddress, amount: 30_000n * WARS, proposer: AGENT, note: "la pelota nueva" },
      BLOCK - 100n,
    );
    const ready = { votes: 2, executed: false, deadline: CLOCK.timestamp + 86_400n, voted: true };
    // A pending execution is newer than the proposal and sorts first, so pick the proposal's own item.
    const at = (change: Partial<Parameters<typeof buildTimeline>[0]> = {}, state: ProposalState = ready) =>
      timeline({ events: [proposal], proposals: new Map([[0n, state]]), ...change }).find((item) => item.text.includes("la pelota nueva"));

    expect(at()).toMatchObject({
      text: $("Propuse pagarle $ 30.000 a Caro por la pelota nueva. Tiene los votos: falta ejecutarla."),
      action: { kind: "execute", proposalId: 0n, canExecute: true },
    });
    expect(at({ viewerIsMember: false })?.action).toMatchObject({ kind: "execute", canExecute: false });
    const executing = { userOpHash: "0x01", kind: "execute" as const, amount: null, token: null, createdAt: NOW };
    expect(at({ pending: [executing] })?.action).toMatchObject({ kind: "execute", canExecute: false });

    const short = at({ warsBalance: 20_000n * WARS });
    expect(short?.text).toBe($("Propuse pagarle $ 30.000 a Caro por la pelota nueva. Tiene los votos, pero al fondo le faltan $ 10.000 para pagarlo."));
    expect(short?.action).toBeUndefined();

    expect(at({}, { ...ready, deadline: CLOCK.timestamp - 1n })).toMatchObject({
      text: $("Propuse pagarle $ 30.000 a Caro por la pelota nueva. Venció sin ejecutarse."),
    });
    expect(at({}, { ...ready, deadline: CLOCK.timestamp - 1n })?.action).toBeUndefined();
  });

  it("doesn't offer to vote again while the viewer's own vote is on its way, but does for a contribution on its way", () => {
    const proposal = event(
      "ProposalCreated",
      { id: 0n, action: 0, a: CARO, b: zeroAddress, amount: 30_000n * WARS, proposer: AGENT, note: "la pelota nueva" },
      BLOCK - 100n,
    );
    const open = { votes: 1, executed: false, deadline: CLOCK.timestamp + 86_400n, voted: false };
    const operation = (kind: "vote" | "contribute") => ({ userOpHash: `0x${kind}`, kind, amount: null, token: null, createdAt: NOW });
    const items = (kind: "vote" | "contribute") =>
      timeline({ events: [proposal], proposals: new Map([[0n, open]]), pending: [operation(kind)] });
    const proposalOf = (list: ReturnType<typeof items>) => list.find((i) => i.action?.kind === "vote");

    expect(items("vote").map((i) => i.text)).toContain("Tu voto está en camino.");
    expect(proposalOf(items("vote"))?.action).toMatchObject({ canVote: false, voted: false });
    expect(proposalOf(items("contribute"))?.action).toMatchObject({ canVote: true, voted: false });
  });

  it("tells what the group did: a payment it voted, a member added, the fund closed", () => {
    const items = timeline({
      events: [
        event("Payment", { member: CARO, amount: 30_000n * WARS }, BLOCK - 300n),
        event("MemberAdded", { member: "0x000000000000000000000000000000000000dEaD" }, BLOCK - 200n),
        event("FundClosed", { warsBalance: 1n, usdtBalance: 0n }, BLOCK - 100n),
      ],
    });
    expect(items.map((i) => [i.actor.kind, i.text])).toEqual([
      ["group", "Se cerró el fondo y se repartió el saldo según lo que aportó cada uno."],
      ["group", "Se sumó una cuenta nueva al fondo."],
      ["group", $("El fondo le pagó $ 30.000 a Caro: la propuesta se aprobó.")],
    ]);
  });

  it("leaves out a RemainderDistributed that moved only rounding dust (spec, 7.3)", () => {
    const items = timeline({
      events: [
        event("RemainderDistributed", { warsBalance: 2n, usdtBalance: 0n }, BLOCK - 200n),
        event("RemainderDistributed", { warsBalance: 5_000n * WARS, usdtBalance: 0n }, BLOCK - 100n),
      ],
    });
    expect(items.map((i) => i.text)).toEqual(["Se repartió lo que llegó después del cierre."]);
  });

  it("shows the expenses the agent still holds and your own operations on their way, not the ones already on chain", () => {
    const at = new Date(NOW.getTime() - 60_000);
    const expense = (status: ExpenseStatus, id: string) => ({
      id,
      by: "Ana",
      amount: 45_000n * WARS,
      note: "la cancha del jueves",
      status,
      createdAt: at,
    });
    const items = timeline({
      expenses: [expense("sending", "1"), expense("waiting", "2"), expense("blocked", "3"), expense("rejected", "4"), expense("reimbursed", "5")],
      pending: [{ userOpHash: "0xop", kind: "contribute", amount: 10n * USDT_UNIT, token: "usdt", createdAt: NOW }],
    });
    expect(items.map((i) => [i.text, i.pending ?? false])).toEqual([
      [$("Tu aporte de 10 USDT está en camino."), true],
      [$("Estoy mirando el gasto de $ 45.000 que cargó Ana (la cancha del jueves)."), true],
      [$("Guardé el gasto de $ 45.000 que cargó Ana (la cancha del jueves): lo devuelvo cuando el fondo tenga los pesos."), false],
      [$("No pude procesar el gasto de $ 45.000 que cargó Ana (la cancha del jueves). Lo vuelvo a intentar en un rato."), false],
      [$("No puedo devolver el gasto de $ 45.000 que cargó Ana (la cancha del jueves)."), false],
    ]);
  });

  it("says once why the agent hasn't converted the USDT waiting, in its own words (F8)", () => {
    const at = new Date(NOW.getTime() - 60_000);
    const hold = (code: string | null) => timeline({ conversionHold: { usdt: 5n * USDT_UNIT, code, at } });
    expect(hold("price-reference")).toEqual([
      {
        id: "conversion-hold",
        at,
        actor: { kind: "agent" },
        text: `Todavía no pasé a pesos ${formatUsdt(5n * USDT_UNIT, "es")}: el precio de referencia del dólar no está al día. Lo vuelvo a intentar en unos minutos.`,
      },
    ]);
    expect(hold("daily-limit")[0]?.text).toContain(": ya cambié todo lo que puedo cambiar por día en este fondo.");
    expect(hold("pool-depth")[0]?.text).toContain(": en el mercado donde los cambio no hay suficientes pesos.");
    expect(hold("price-gap")[0]?.text).toContain(": el precio del mercado se alejó más de 2 % del de referencia.");
    expect(hold("price-floor")[0]?.text).toContain(": el mercado paga menos de lo que permiten mis reglas.");
    // Blocked, or a code this web doesn't know yet.
    expect(hold(null)[0]?.text).toContain(": no pude hacer la operación.");
    expect(hold("something-new")[0]?.text).toContain(": no pude hacer la operación.");
    expect(timeline({ conversionHold: null })).toEqual([]);
  });

  it("leaves a pass to pesos out: it moves the member's own account, not the fund (spec, 9.2)", () => {
    const pass = { userOpHash: "0xpass", kind: "cash-out" as const, amount: 5_000n * WARS, token: "wars" as const, createdAt: NOW };
    expect(timeline({ pending: [pass] })).toEqual([]);
  });

  it("leaves a key change out: it swaps the passkey of the member's own account (spec, 9.5)", () => {
    const change = { userOpHash: "0xkey", kind: "key-change" as const, amount: null, token: null, createdAt: NOW };
    expect(timeline({ pending: [change] })).toEqual([]);
  });

  it("says the viewer's own proposal on its way, in Spanish and English (spec, 9.4)", () => {
    const pending = [{ userOpHash: "0xp", kind: "propose", amount: null, token: null, createdAt: NOW }] as const;
    expect(timeline({ pending }).map((i) => [i.text, i.pending])).toEqual([["Tu propuesta está en camino.", true]]);
    expect(timeline({ pending, m: en }).map((i) => i.text)).toEqual(["Your proposal is on its way."]);
  });
});

// The sentences the cases above don't reach, in Spanish: every one is as it was before the dictionary (Messages),
// except that "alguien" now starts a sentence capitalized.
describe("buildTimeline: the other sentences, in Spanish", () => {
  const OPEN: ProposalState = { votes: 1, executed: false, deadline: CLOCK.timestamp + 86_400n, voted: false };
  const proposed = (action: number, a: Address, amount: bigint, proposer: Address, note = "") =>
    timeline({
      events: [event("ProposalCreated", { id: 0n, action, a, b: zeroAddress, amount, proposer, note }, BLOCK - 100n)],
      proposals: new Map([[0n, OPEN]]),
    })[0]!;

  it("says each kind of proposal, and what the agent says about the ones it makes", () => {
    expect(proposed(0, CARO, 30_000n * WARS, AGENT).text).toBe($("Propuse pagarle $ 30.000 a Caro. Lleva 1 de 2 votos."));
    expect(proposed(1, zeroAddress, 0n, BETO).text).toBe("Beto propuso sumar a una cuenta nueva al fondo. Lleva 1 de 2 votos.");
    expect(proposed(2, CARO, 0n, BETO).text).toBe("Beto propuso sacar a Caro del fondo. Lleva 1 de 2 votos.");
    expect(proposed(3, CARO, 0n, BETO).text).toBe("Beto propuso cambiar la cuenta de Caro. Lleva 1 de 2 votos.");
    expect(proposed(4, zeroAddress, 80_000n * WARS, BETO).text).toBe($("Beto propuso cambiar el tope semanal de la cancha a $ 80.000. Lleva 1 de 2 votos."));
    expect(proposed(5, zeroAddress, 3n, BETO).text).toBe("Beto propuso pedir 3 votos para lo que no es la cancha. Lleva 1 de 2 votos.");
    expect(proposed(6, zeroAddress, 0n, BETO).text).toBe("Beto propuso cambiar el agente. Lleva 1 de 2 votos.");
    expect(proposed(0, CARO, 30_000n * WARS, AGENT).detail).toBe("Lo que no puedo devolver por mi cuenta lo tienen que votar: hacen falta 2 votos.");
    expect(proposed(7, zeroAddress, 0n, BETO).detail).toBeUndefined();
  });

  it("says a name it doesn't have as 'alguien', capitalized where it starts the sentence, and the viewer's own operations on their way as 'Vos'", () => {
    const at = (events: Parameters<typeof buildTimeline>[0]["events"], proposals: Parameters<typeof buildTimeline>[0]["proposals"] = new Map()) =>
      timeline({ events, proposals })[0]?.text;
    const stranger = "0x000000000000000000000000000000000000dEaD";

    expect(at([event("MemberRemoved", { member: stranger, warsReturned: 0n, usdtReturned: 0n }, BLOCK - 100n)])).toBe(
      "Alguien dejó el fondo y se llevó su parte.",
    );
    expect(at([event("Contribution", { member: stranger, token: WARS_TOKEN, amount: 10_000n * WARS, creditedWars: 10_000n * WARS }, BLOCK - 100n)])).toBe(
      $("Alguien aportó $ 10.000."),
    );
    expect(proposed(6, zeroAddress, 0n, stranger).text).toBe("Alguien propuso cambiar el agente. Lleva 1 de 2 votos.");
    expect(at([event("MemberReplaced", { oldMember: ANA, newMember: stranger }, BLOCK - 100n)])).toBe("Alguien cambió de cuenta.");
    // Inside a sentence it stays as it is.
    expect(at([event("Reimbursement", { member: stranger, amount: 45_000n * WARS, ref: pad("0x01", { size: 32 }), week: 2n }, BLOCK - 100n)])).toBe(
      $("Le devolví $ 45.000 a alguien por la cancha. Quedan $ 15.000 del tope de esta semana."),
    );

    const vote = { userOpHash: "0xv", kind: "vote" as const, amount: null, token: null, createdAt: NOW };
    expect(timeline({ pending: [vote] })[0]?.actor).toEqual({ kind: "member", name: "Vos" });
  });

  it("tells a member leaving or switching account, a cap or the votes changing, and a new agent", () => {
    const items = timeline({
      events: [
        event("MemberRemoved", { member: CARO, warsReturned: 0n, usdtReturned: 0n }, BLOCK - 600n),
        event("MemberReplaced", { oldMember: BETO, newMember: ANA }, BLOCK - 500n),
        event("WeeklyCapChanged", { cap: 80_000n * WARS }, BLOCK - 400n),
        event("VotesRequiredChanged", { votes: 3 }, BLOCK - 300n),
        event("AgentChanged", { agent: BETO }, BLOCK - 200n),
        event("MemberAdded", { member: ANA }, BLOCK - 100n),
      ],
    });
    expect(items.map((i) => i.text)).toEqual([
      "Se sumó Ana al fondo.",
      "Cambió el agente del fondo.",
      "Ahora hacen falta 3 votos para lo que no es la cancha.",
      $("El tope semanal de la cancha ahora es $ 80.000."),
      "Ana cambió de cuenta.",
      "Caro dejó el fondo y se llevó su parte.",
    ]);
  });
});

describe("buildTimeline in English", () => {
  /** English amounts: "ARS 45,000" and "10 USDT", with the no-break spaces. */
  const ars = (text: string) => text.replaceAll("ARS ", `ARS${NBSP}`).replaceAll(" USDT", `${NBSP}USDT`);
  const english = (change: Partial<Parameters<typeof buildTimeline>[0]> = {}) => timeline({ ...change, m: en });
  const open: ProposalState = { votes: 1, executed: false, deadline: CLOCK.timestamp + 86_400n, voted: false };
  const proposal = (action: number, a: Address, amount: bigint, proposer: Address, note = "") =>
    event("ProposalCreated", { id: 0n, action, a, b: zeroAddress, amount, proposer, note }, BLOCK - 100n);
  const proposed = (action: number, a: Address, amount: bigint, proposer: Address, note = "") =>
    english({ events: [proposal(action, a, amount, proposer, note)], proposals: new Map([[0n, open]]) })[0]!;

  it("says each movement in English, with amounts as ARS, newest first, the agent in first person", () => {
    const items = english({
      events: [
        event("Contribution", { member: BETO, token: USDT, amount: 10n * USDT_UNIT, creditedWars: 16_070n * WARS }, BLOCK - 600n),
        event("Conversion", { usdtIn: 10n * USDT_UNIT, warsOut: 16_050n * WARS }, BLOCK - 500n),
        event("Contribution", { member: ANA, token: WARS_TOKEN, amount: 10_000n * WARS, creditedWars: 10_000n * WARS }, BLOCK - 400n),
        event("Reimbursement", { member: ANA, amount: 45_000n * WARS, ref: pad("0x01", { size: 32 }), week: 2n }, BLOCK - 300n),
      ],
    });
    expect(items.map((i) => [i.actor, i.text])).toEqual([
      [{ kind: "agent" }, ars("I paid Ana back ARS 45,000 for “la cancha”. This week's cap has ARS 15,000 left.")],
      [{ kind: "member", name: "Ana" }, ars("Ana contributed ARS 10,000.")],
      [{ kind: "agent" }, ars("I converted the 10 USDT that came in to ARS 16,050.")],
      [{ kind: "member", name: "Beto" }, ars("Beto contributed 10 USDT.")],
    ]);
    expect(items[0]!.text.startsWith(`I paid Ana back ARS${NBSP}45,000 for “la cancha”.`)).toBe(true);
    expect(items[0]?.detail).toBe(ars("It was “la cancha”, which I pay back without a vote up to ARS 60,000 per week."));
  });

  it("writes amounts the English way, with the point for decimals", () => {
    const items = english({
      events: [
        event("Contribution", { member: BETO, token: USDT, amount: 10_500_000n, creditedWars: 16_070n * WARS }, BLOCK - 200n),
        event("Conversion", { usdtIn: 10_500_000n, warsOut: 16_050n * WARS + 37n * 10n ** 16n }, BLOCK - 100n),
      ],
    });
    expect(items.map((i) => i.text)).toEqual([
      ars("I converted the 10.5 USDT that came in to ARS 16,050.37."),
      ars("Beto contributed 10.5 USDT."),
    ]);
  });

  it("explains the conversion in plain words, without naming the exchange or the price feed (spec, 9)", () => {
    const [conversion] = english({ events: [event("Conversion", { usdtIn: 10n * USDT_UNIT, warsOut: 16_050n * WARS }, BLOCK - 500n)] });
    expect(conversion?.detail).toBe(
      "I converted them and checked that the price was within 2 % of the dollar's reference price, as my rules say.",
    );
    expect(conversion?.detail).not.toMatch(/\b(uniswap|chainlink|oracle|pool|gas|hash|wallet|blockchain|token|exchange)\b/i);
  });

  it("uses the weekly cap that held at the time, and says 'that week' for an older week", () => {
    const items = english({
      events: [
        event("Reimbursement", { member: ANA, amount: 20_000n * WARS, ref: pad("0x01", { size: 32 }), week: 1n }, BLOCK - 700_000n),
        event("WeeklyCapChanged", { cap: 80_000n * WARS }, BLOCK - 600_000n),
        event("Reimbursement", { member: BETO, amount: 50_000n * WARS, ref: pad("0x02", { size: 32 }), week: 2n }, BLOCK - 100n),
      ],
    });
    expect(items.map((i) => i.text)).toEqual([
      ars("I paid Beto back ARS 50,000 for “la cancha”. This week's cap has ARS 30,000 left."),
      ars("The weekly cap for “la cancha” is now ARS 80,000."),
      ars("I paid Ana back ARS 20,000 for “la cancha”. That week's cap had ARS 40,000 left."),
    ]);
  });

  it("says why it didn't convert in English", () => {
    const at = new Date(NOW.getTime() - 60_000);
    const hold = (code: string | null) => english({ conversionHold: { usdt: 5n * USDT_UNIT, code, at } });
    expect(hold("price-reference")).toEqual([
      {
        id: "conversion-hold",
        at,
        actor: { kind: "agent" },
        text: ars("I haven't converted 5 USDT to pesos yet: the dollar's reference price isn't up to date. I'll try again in a few minutes."),
      },
    ]);
    expect(hold("daily-limit")[0]?.text).toContain(": I've already converted all I can in a day for this fund.");
    expect(hold("pool-depth")[0]?.text).toContain(": the market where I convert them doesn't have enough pesos.");
    expect(hold("price-gap")[0]?.text).toContain(": the market price is more than 2 % away from the reference.");
    expect(hold("price-floor")[0]?.text).toContain(": the market pays less than my rules allow.");
    // Blocked, or a code this web doesn't know yet.
    expect(hold(null)[0]?.text).toContain(": I couldn't make the trade.");
    expect(hold("something-new")[0]?.text).toContain(": I couldn't make the trade.");
  });

  it("says each kind of proposal, in first person when the agent makes it and in third when a member does", () => {
    expect(proposed(0, CARO, 30_000n * WARS, AGENT, "la pelota nueva").text).toBe(
      ars("I proposed paying Caro ARS 30,000 for “la pelota nueva”. It has 1 of 2 votes."),
    );
    expect(proposed(0, CARO, 30_000n * WARS, AGENT).text).toBe(ars("I proposed paying Caro ARS 30,000. It has 1 of 2 votes."));
    expect(proposed(1, zeroAddress, 0n, BETO).text).toBe("Beto proposed adding a new account to the fund. It has 1 of 2 votes.");
    expect(proposed(2, CARO, 0n, BETO).text).toBe("Beto proposed removing Caro from the fund. It has 1 of 2 votes.");
    expect(proposed(3, CARO, 0n, BETO).text).toBe("Beto proposed changing Caro's account. It has 1 of 2 votes.");
    expect(proposed(4, zeroAddress, 80_000n * WARS, BETO).text).toBe(
      ars("Beto proposed changing the weekly cap for “la cancha” to ARS 80,000. It has 1 of 2 votes."),
    );
    expect(proposed(5, zeroAddress, 3n, BETO).text).toBe("Beto proposed requiring 3 votes for anything that isn't “la cancha”. It has 1 of 2 votes.");
    expect(proposed(6, zeroAddress, 0n, BETO).text).toBe("Beto proposed changing the agent. It has 1 of 2 votes.");
    expect(proposed(7, zeroAddress, 0n, BETO).text).toBe("Beto proposed closing the fund and splitting the balance. It has 1 of 2 votes.");
    expect(proposed(0, CARO, 30_000n * WARS, AGENT).detail).toBe("What I can't pay back on my own has to be voted on: 2 votes are needed.");
    expect(proposed(7, zeroAddress, 0n, BETO).detail).toBeUndefined();
  });

  it("says where a proposal stands: voting, ready to carry out, short of pesos, approved, expired", () => {
    const pay = proposal(0, CARO, 30_000n * WARS, AGENT, "la pelota nueva");
    const stand = (state: ProposalState, change: Partial<Parameters<typeof buildTimeline>[0]> = {}) =>
      english({ events: [pay], proposals: new Map([[0n, state]]), ...change })[0]!;
    const head = "I proposed paying Caro ARS 30,000 for “la pelota nueva”.";
    const ready = { votes: 2, executed: false, deadline: CLOCK.timestamp + 86_400n, voted: true };

    expect(stand(open)).toMatchObject({
      text: ars(`${head} It has 1 of 2 votes.`),
      action: { kind: "vote", proposalId: 0n, votes: 1, required: 2, canVote: true, voted: false, completes: true },
    });
    expect(stand(ready)).toMatchObject({
      text: ars(`${head} It has the votes: it still needs to be carried out.`),
      action: { kind: "execute", proposalId: 0n, canExecute: true },
    });
    expect(stand(ready, { warsBalance: 20_000n * WARS }).text).toBe(ars(`${head} It has the votes, but the fund needs ARS 10,000 more to pay it.`));
    expect(stand({ ...ready, executed: true }).text).toBe(ars(`${head} It was approved.`));
    expect(stand({ ...ready, deadline: CLOCK.timestamp - 1n }).text).toBe(ars(`${head} It expired without being carried out.`));
    expect(stand({ ...open, deadline: CLOCK.timestamp - 1n }).text).toBe(ars(`${head} It expired without the votes it needed.`));
  });

  it("tells what the group did: a payment it voted, a member added, replaced or removed, the rules changed, the fund closed", () => {
    const items = english({
      events: [
        event("Payment", { member: CARO, amount: 30_000n * WARS }, BLOCK - 900n),
        event("MemberAdded", { member: ANA }, BLOCK - 800n),
        event("MemberAdded", { member: "0x000000000000000000000000000000000000dEaD" }, BLOCK - 700n),
        event("MemberReplaced", { oldMember: BETO, newMember: ANA }, BLOCK - 600n),
        event("MemberRemoved", { member: CARO, warsReturned: 0n, usdtReturned: 0n }, BLOCK - 500n),
        event("WeeklyCapChanged", { cap: 80_000n * WARS }, BLOCK - 400n),
        event("VotesRequiredChanged", { votes: 3 }, BLOCK - 300n),
        event("AgentChanged", { agent: BETO }, BLOCK - 200n),
        event("FundClosed", { warsBalance: 1n, usdtBalance: 0n }, BLOCK - 100n),
      ],
    });
    expect(items.map((i) => [i.actor.kind, i.text])).toEqual([
      ["group", "The fund was closed and the balance was split according to what each person contributed."],
      ["group", "The fund's agent was changed."],
      ["group", "Now 3 votes are needed for anything that isn't “la cancha”."],
      ["group", ars("The weekly cap for “la cancha” is now ARS 80,000.")],
      ["group", "Caro left the fund and took their share."],
      ["group", "Ana switched accounts."],
      ["group", "A new account joined the fund."],
      ["group", "Ana joined the fund."],
      ["group", ars("The fund paid Caro ARS 30,000: the proposal was approved.")],
    ]);
  });

  it("leaves out a RemainderDistributed that moved only rounding dust, and says the one that didn't", () => {
    const items = english({
      events: [
        event("RemainderDistributed", { warsBalance: 2n, usdtBalance: 0n }, BLOCK - 200n),
        event("RemainderDistributed", { warsBalance: 5_000n * WARS, usdtBalance: 0n }, BLOCK - 100n),
      ],
    });
    expect(items.map((i) => i.text)).toEqual(["What arrived after the fund closed was split among the members."]);
  });

  it("says a name it doesn't have as 'someone', capitalized where it starts the sentence", () => {
    const [removed] = english({ events: [event("MemberRemoved", { member: zeroAddress, warsReturned: 0n, usdtReturned: 0n }, BLOCK - 100n)] });
    expect(removed?.text).toBe("Someone left the fund and took their share.");
    const [paidBack] = english({
      events: [event("Reimbursement", { member: zeroAddress, amount: 45_000n * WARS, ref: pad("0x01", { size: 32 }), week: 2n }, BLOCK - 100n)],
    });
    expect(paidBack?.text).toBe(ars("I paid someone back ARS 45,000 for “la cancha”. This week's cap has ARS 15,000 left."));
  });

  it("shows a member's name as they wrote it where it starts a sentence, and capitalizes only the stand-ins", () => {
    const written = new Map<Address, string>([
      [ANA, "juan"],
      [BETO, "constructor"],
    ]);
    const at = (events: Parameters<typeof buildTimeline>[0]["events"], proposals: Parameters<typeof buildTimeline>[0]["proposals"] = new Map()) =>
      english({ names: written, events, proposals })[0]?.text;

    expect(at([event("Contribution", { member: ANA, token: WARS_TOKEN, amount: 10_000n * WARS, creditedWars: 10_000n * WARS }, BLOCK - 100n)])).toBe(
      ars("juan contributed ARS 10,000."),
    );
    expect(at([proposal(6, zeroAddress, 0n, ANA)], new Map([[0n, open]]))).toBe("juan proposed changing the agent. It has 1 of 2 votes.");
    expect(at([event("MemberAdded", { member: ANA }, BLOCK - 100n)])).toBe("juan joined the fund.");
    expect(at([event("MemberRemoved", { member: BETO, warsReturned: 0n, usdtReturned: 0n }, BLOCK - 100n)])).toBe(
      "constructor left the fund and took their share.",
    );
    expect(at([event("MemberReplaced", { oldMember: ANA, newMember: BETO }, BLOCK - 100n)])).toBe("constructor switched accounts.");

    // The stand-ins, for an address nobody named, still open the sentence capitalized.
    const stranger = "0x000000000000000000000000000000000000dEaD";
    expect(at([event("Contribution", { member: stranger, token: WARS_TOKEN, amount: 10_000n * WARS, creditedWars: 10_000n * WARS }, BLOCK - 100n)])).toBe(
      ars("Someone contributed ARS 10,000."),
    );
    expect(at([proposal(6, zeroAddress, 0n, stranger)], new Map([[0n, open]]))).toBe("Someone proposed changing the agent. It has 1 of 2 votes.");
    expect(at([event("MemberAdded", { member: stranger }, BLOCK - 100n)])).toBe("A new account joined the fund.");
  });

  it("says the expenses the agent still holds, one sentence for each state, with the note in the member's own words", () => {
    const at = new Date(NOW.getTime() - 60_000);
    const expense = (status: ExpenseStatus, id: string, note = "la cancha del jueves") => ({ id, by: "Ana", amount: 45_000n * WARS, note, status, createdAt: at });
    const items = english({
      expenses: [
        expense("new", "0"),
        expense("sending", "1"),
        expense("waiting", "2"),
        expense("blocked", "3"),
        expense("rejected", "4"),
        expense("reimbursed", "5"),
        expense("rejected", "6", ""),
      ],
    });
    const what = "the ARS 45,000 expense that Ana added (“la cancha del jueves”)";
    expect(items.map((i) => [i.text, i.pending ?? false])).toEqual([
      [ars(`I'm looking at ${what}.`), true],
      [ars(`I'm looking at ${what}.`), true],
      [ars(`I've saved ${what}: I'll pay it back when the fund has the pesos.`), false],
      [ars(`I couldn't process ${what}. I'll try again in a while.`), false],
      [ars(`I can't pay back ${what}.`), false],
      [ars("I can't pay back the ARS 45,000 expense that Ana added."), false],
    ]);
  });

  it("says your own operations on their way, as 'You', and leaves a pass to pesos out", () => {
    const operation = (kind: "vote" | "execute" | "contribute" | "cash-out", amount: bigint | null = null, token: "wars" | "usdt" | null = null) => ({
      userOpHash: `0x${kind}${token}`,
      kind,
      amount,
      token,
      createdAt: NOW,
    });
    const items = english({
      pending: [
        operation("vote"),
        operation("execute"),
        operation("contribute", 10n * USDT_UNIT, "usdt"),
        operation("contribute", 10_000n * WARS, "wars"),
        operation("cash-out", 5_000n * WARS, "wars"),
      ],
    });
    expect(items.map((i) => [i.actor, i.text, i.pending])).toEqual([
      [{ kind: "member", name: "You" }, "Your vote is on its way.", true],
      [{ kind: "member", name: "You" }, "Your action to carry out the proposal is on its way.", true],
      [{ kind: "member", name: "You" }, ars("Your contribution of 10 USDT is on its way."), true],
      [{ kind: "member", name: "You" }, ars("Your contribution of ARS 10,000 is on its way."), true],
    ]);
  });

  it("tells the summary of a week that closed, with the panel that shows it (spec, 9.4)", () => {
    const at = new Date(NOW.getTime() - 3_600_000);
    expect(timeline({ summaries: [{ week: 0, at }] })).toEqual([
      { id: "summary:0", at, actor: { kind: "agent" }, text: "Cerré la semana 1. Te dejo el resumen para el grupo.", action: { kind: "summary", week: 0 } },
    ]);
    expect(timeline({ summaries: [{ week: 2, at }], m: en })[0]?.text).toBe("I closed week 3. Here's the summary for the group.");
  });
});

describe("buildTimeline: asking to join a live fund (spec, 9.4)", () => {
  const LUCAS = getAddress("0x000000000000000000000000000000000000aaa4");
  const ASKED = new Date(NOW.getTime() - 3_600_000);
  const withLucas = new Map([...NAMES, [LUCAS, "Lucas"]]);
  const asked = { account: LUCAS, name: "Lucas", at: ASKED, open: true };
  const OPEN: ProposalState = { votes: 1, executed: false, deadline: CLOCK.timestamp + 86_400n, voted: true };
  const addLucas = (state: ProposalState) => ({
    events: [event("ProposalCreated", { id: 4n, action: 1, a: LUCAS, b: zeroAddress, amount: 0n, proposer: ANA, note: "" }, BLOCK - 100n)],
    proposals: new Map([[4n, state]]),
  });

  it("shows a member who asked, with Proponer sumarlo, in Spanish and English", () => {
    expect(timeline({ names: withLucas, joinRequests: [asked], canAddMembers: true })).toEqual([
      {
        id: `join:${LUCAS}`,
        at: ASKED,
        actor: { kind: "member", name: "Lucas" },
        text: "Lucas pidió sumarse al fondo.",
        action: { kind: "propose-member", account: LUCAS, canPropose: true },
      },
    ]);
    expect(timeline({ names: withLucas, joinRequests: [asked], canAddMembers: true, m: en })[0]?.text).toBe("Lucas asked to join the fund.");
  });

  it("doesn't offer it while the fund is full or the viewer's proposal is on its way, and shows nothing to a non-member", () => {
    expect(timeline({ joinRequests: [asked], canAddMembers: false })[0]?.action).toEqual({ kind: "propose-member", account: LUCAS, canPropose: false });
    const pending = [{ userOpHash: "0xp", kind: "propose", amount: null, token: null, createdAt: NOW }] as const;
    const onItsWay = timeline({ joinRequests: [asked], canAddMembers: true, pending });
    expect(onItsWay.find((item) => item.id === `join:${LUCAS}`)?.action).toMatchObject({ canPropose: false });
    expect(timeline({ joinRequests: [asked], canAddMembers: true, viewerIsMember: false })).toEqual([]);
  });

  it("leaves the request out while a proposal to add them is open, which names them, and brings it back once that one expired", () => {
    const open = timeline({ names: withLucas, joinRequests: [asked], canAddMembers: true, ...addLucas(OPEN) });
    expect(open.map((item) => item.text)).toEqual(["Ana propuso sumar a Lucas al fondo. Lleva 1 de 2 votos."]);
    expect(timeline({ names: withLucas, joinRequests: [asked], ...addLucas(OPEN), m: en })[0]?.text).toBe(
      "Ana proposed adding Lucas to the fund. It has 1 of 2 votes.",
    );
    const expired = timeline({ names: withLucas, joinRequests: [asked], canAddMembers: true, ...addLucas({ ...OPEN, deadline: CLOCK.timestamp - 1n }) });
    // Newest first: the proposal (100 s ago) above the request (an hour ago).
    expect(expired.map((item) => item.text)).toEqual(["Ana propuso sumar a Lucas al fondo. Venció sin los votos necesarios.", "Lucas pidió sumarse al fondo."]);
  });

  it("says a request that expired without a proposal, at the time it expired, with no button", () => {
    const EXPIRED = new Date(NOW.getTime() - 60_000);
    const [item] = timeline({ names: withLucas, joinRequests: [{ ...asked, at: EXPIRED, open: false }], canAddMembers: true });
    expect(item).toEqual({ id: `join:${LUCAS}`, at: EXPIRED, actor: { kind: "member", name: "Lucas" }, text: "Venció el pedido de Lucas." });
    expect(timeline({ joinRequests: [{ ...asked, open: false }], m: en })[0]?.text).toBe("Lucas's request to join expired.");
  });

  it("says 'una cuenta nueva' in a proposal to add someone it has no name for, as before", () => {
    expect(timeline(addLucas(OPEN))[0]?.text).toBe("Ana propuso sumar a una cuenta nueva al fondo. Lleva 1 de 2 votos.");
    expect(timeline({ ...addLucas(OPEN), m: en })[0]?.text).toBe("Ana proposed adding a new account to the fund. It has 1 of 2 votes.");
  });

  describe("a heads-up when the name is someone else's", () => {
    const MORA = getAddress("0x000000000000000000000000000000000000aaa5");
    const MEMBERS = ["Ana", "Beto", "Caro"];
    const SPANISH = "Ojo: hay otra persona que se llama Lucas. Antes de proponer, confirmá en el grupo que es quien esperan.";
    const ENGLISH = "Heads up: someone else here is also called Lucas. Before you propose, check with the group that this is who you're expecting.";
    const named = (name: string, account: Address = LUCAS) => ({ ...asked, account, name });
    /** The timeline of a fund with room for one more, which is where Proponer sumarlo is offered. */
    const room = (change: Partial<Parameters<typeof buildTimeline>[0]> = {}) => timeline({ canAddMembers: true, ...change });
    const itemOf = (items: ReturnType<typeof timeline>, account: Address = LUCAS) => items.find((item) => item.id === `join:${account}`);
    /** A request's heads-up, which goes with its Proponer sumarlo action. */
    const headsUpOf = (items: ReturnType<typeof timeline>, account: Address = LUCAS) => {
      const action = itemOf(items, account)?.action;
      return action?.kind === "propose-member" ? action.headsUp : undefined;
    };

    it("tells a request named like a member to check with the group first, in Spanish and in English", () => {
      const items = room({ memberNames: [...MEMBERS, "Lucas"], joinRequests: [asked] });
      // The sentence and the button are as they were: the line is added to the button's action, nothing else changes.
      expect(items).toEqual([
        {
          id: `join:${LUCAS}`,
          at: ASKED,
          actor: { kind: "member", name: "Lucas" },
          text: "Lucas pidió sumarse al fondo.",
          action: { kind: "propose-member", account: LUCAS, canPropose: true, headsUp: SPANISH },
        },
      ]);
      expect(headsUpOf(room({ memberNames: [...MEMBERS, "Lucas"], joinRequests: [asked], m: en }))).toBe(ENGLISH);
    });

    it("matches the name without caring for case, accents or spaces", () => {
      for (const [requester, member] of [["Lucás", "lucas"], ["LUCAS", "Lucás"]] as const) {
        expect(headsUpOf(room({ memberNames: [member], joinRequests: [named(requester)] })), `${requester} / ${member}`).toBe(
          SPANISH.replace("Lucas", requester),
        );
      }
    });

    it("gives it to both when two open requests share a name", () => {
      const items = room({ joinRequests: [named("Lucas"), named("lucás", MORA)] });
      expect(headsUpOf(items)).toBe(SPANISH);
      expect(headsUpOf(items, MORA)).toBe(SPANISH.replace("Lucas", "lucás"));
      expect(headsUpOf(room({ joinRequests: [named("Lucas"), named("lucás", MORA)], m: en }), MORA)).toBe(ENGLISH.replace("Lucas", "lucás"));
    });

    it("counts a request that is already being proposed as another open request with the same name", () => {
      const twin = named("Lucas", MORA);
      const items = room({ memberNames: MEMBERS, joinRequests: [asked, twin], ...addLucas(OPEN) });
      // Lucas's own request is told by the proposal; the other Lucas's still shows, with the line.
      expect(items.filter((item) => item.id.startsWith("join:")).map((item) => item.id)).toEqual([`join:${MORA}`]);
      expect(headsUpOf(items, MORA)).toBe(SPANISH);
    });

    it("takes the same account written two ways for one person, not for two with the same name", () => {
      const lowercase = { ...asked, account: LUCAS.toLowerCase() as Address };
      const items = room({ memberNames: MEMBERS, joinRequests: [asked, lowercase] });
      expect(items).toHaveLength(2);
      expect(headsUpOf(items)).toBeUndefined();
      expect(headsUpOf(items, lowercase.account)).toBeUndefined();
    });

    it("gives none to a name nobody else here has", () => {
      const items = room({ memberNames: MEMBERS, joinRequests: [asked, named("Mora", MORA)] });
      expect(items).toHaveLength(2);
      expect(items.every((item) => item.action?.kind === "propose-member" && !("headsUp" in item.action))).toBe(true);
    });

    it("gives none to an expired request, and it doesn't count as another person for an open one", () => {
      const expired = { ...named("Lucas"), open: false };
      const [item] = room({ memberNames: [...MEMBERS, "Lucas"], joinRequests: [expired] });
      expect(item).toEqual({ id: `join:${LUCAS}`, at: ASKED, actor: { kind: "member", name: "Lucas" }, text: "Venció el pedido de Lucas." });

      const items = room({ memberNames: MEMBERS, joinRequests: [expired, named("Lucas", MORA)] });
      expect(headsUpOf(items, MORA)).toBeUndefined();
      expect(itemOf(items)?.action).toBeUndefined();
    });

    it("gives it only where Proponer sumarlo is offered: not in a full fund, nor with the viewer's own proposal on its way", () => {
      const request = { memberNames: [...MEMBERS, "Lucas"], joinRequests: [asked] };
      expect(headsUpOf(room(request))).toBe(SPANISH);

      const full = timeline({ ...request, canAddMembers: false });
      expect(itemOf(full)?.action).toEqual({ kind: "propose-member", account: LUCAS, canPropose: false });
      const pending = [{ userOpHash: "0xp", kind: "propose", amount: null, token: null, createdAt: NOW }] as const;
      const onItsWay = room({ ...request, pending });
      expect(itemOf(onItsWay)?.action).toEqual({ kind: "propose-member", account: LUCAS, canPropose: false });
    });

    it("shows nothing on the public view, where requests never show, however the names match", () => {
      expect(room({ memberNames: [...MEMBERS, "Lucas"], joinRequests: [asked, named("Lucas", MORA)], viewerIsMember: false })).toEqual([]);
    });
  });
});

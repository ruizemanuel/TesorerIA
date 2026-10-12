import { USDT, WARS as WARS_TOKEN } from "@tesoreria/agent";
import { type Address, pad, toHex, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import type { ExpenseStatus } from "../src/lib/db/schema";
import { NBSP, formatUsdt } from "../src/lib/format";
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
        text: `Todavía no pasé a pesos ${formatUsdt(5n * USDT_UNIT)}: el precio de referencia del dólar no está al día. Lo vuelvo a intentar en unos minutos.`,
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
});

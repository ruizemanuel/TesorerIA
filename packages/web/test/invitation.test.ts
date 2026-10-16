import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DraftSummary } from "../src/lib/funds";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { invitationFor } from "../src/lib/invitation";
import { MAX_OPEN_JOIN_REQUESTS } from "../src/lib/join-requests";
import { randomAccount } from "./support/db";

const ME = randomUUID();
const FUND = randomAccount();

/** A fund with `count` people, the viewer among them when `withMe`. */
function fund(status: DraftSummary["status"], count: number, withMe = false): Pick<DraftSummary, "id" | "status" | "address" | "members"> {
  const members = Array.from({ length: count }, (_, i) => ({ userId: withMe && i === 0 ? ME : randomUUID(), name: `P${i}`, account: randomAccount() }));
  return { id: randomUUID(), status, address: status === "live" ? FUND : null, members };
}

describe("invitationFor", () => {
  it("offers to join a draft with room, to anyone, logged in or not", () => {
    for (const viewer of [null, ME]) {
      expect(invitationFor(fund("draft", 3), viewer, es)).toEqual({ kind: "join" });
      expect(invitationFor(fund("draft", 9), viewer, es)).toEqual({ kind: "join" });
    }
    // Someone already in it can always "join" again: it takes them to the draft.
    expect(invitationFor(fund("draft", 10, true), ME, es)).toEqual({ kind: "join" });
  });

  it("says why there's no joining a draft that is full, being created or already going", () => {
    expect(invitationFor(fund("draft", 10), ME, es)).toEqual({ kind: "closed", why: "Este fondo ya está completo." });
    expect(invitationFor(fund("deploying", 4), null, es)).toEqual({ kind: "closed", why: "Este fondo ya se está creando." });
    expect(invitationFor(fund("live", 4), ME, es)).toEqual({ kind: "request", again: false });
  });

  it("takes someone who is already in it to their fund", () => {
    const deploying = fund("deploying", 4, true);
    expect(invitationFor(deploying, ME, es)).toEqual({
      kind: "closed",
      why: "Este fondo ya se está creando.",
      link: { href: `/f/borrador/${deploying.id}`, label: "Ir al fondo" },
    });
    expect(invitationFor(fund("live", 4, true), ME, es)).toEqual({
      kind: "closed",
      why: "Este fondo ya está andando.",
      link: { href: `/f/${FUND}`, label: "Ir al fondo" },
    });
  });

  it("says why and where to go in English", () => {
    expect(invitationFor(fund("draft", 10), ME, en)).toEqual({ kind: "closed", why: "This fund is already full." });
    expect(invitationFor(fund("deploying", 4), null, en)).toEqual({ kind: "closed", why: "This fund is already being created." });
    const live = invitationFor(fund("live", 4, true), ME, en);
    expect(live).toMatchObject({ kind: "closed", why: "This fund is already running.", link: { href: `/f/${FUND}`, label: "Go to the fund" } });
  });
});

describe("invitationFor a live fund (spec, 9.4)", () => {
  const OPEN = { requestedAt: new Date(), open: true };
  const EXPIRED = { requestedAt: new Date(), open: false };
  const PROPOSED = { proposer: "Ana", votes: 1, required: 2 };

  it("offers to ask to join to anyone not in it, logged in or not, and to ask again once the request expired", () => {
    for (const viewer of [null, ME]) expect(invitationFor(fund("live", 4), viewer, es)).toEqual({ kind: "request", again: false });
    expect(invitationFor(fund("live", 4), ME, es, { request: EXPIRED, proposal: null })).toEqual({
      kind: "request",
      again: true,
      why: "Tu pedido venció. Pedile a alguien del grupo que te proponga.",
    });
  });

  it("says where an open request stands: waiting for a proposal, or proposed with its votes", () => {
    expect(invitationFor(fund("live", 4), ME, es, { request: OPEN, proposal: null })).toEqual({
      kind: "closed",
      why: "Pediste sumarte. Alguien del grupo tiene que proponerte, y después se vota. Cuando se apruebe, vas a ver el fondo acá.",
    });
    expect(invitationFor(fund("live", 4), ME, es, { request: OPEN, proposal: PROPOSED })).toEqual({ kind: "closed", why: "Ana propuso sumarte. Lleva 1 de 2 votos." });
    // A proposal made in time goes on, even once the request stopped counting (spec, 9.4).
    expect(invitationFor(fund("live", 4), ME, es, { request: EXPIRED, proposal: PROPOSED })).toMatchObject({ why: "Ana propuso sumarte. Lleva 1 de 2 votos." });
  });

  it("says the fund is full, whatever the request (Review Focus 4), and takes a member to it", () => {
    for (const join of [{ request: null, proposal: null }, { request: OPEN, proposal: PROPOSED }]) {
      expect(invitationFor(fund("live", 10), ME, es, join)).toEqual({ kind: "closed", why: "El fondo ya tiene 10 miembros, que es el máximo." });
    }
    expect(invitationFor(fund("live", 10, true), ME, es)).toEqual({ kind: "closed", why: "Este fondo ya está andando.", link: { href: `/f/${FUND}`, label: "Ir al fondo" } });
  });

  it("closes the invitation, before any form, on a fund that already has 5 open requests from other people, so nobody makes an account for nothing", () => {
    const refusal = { kind: "closed", why: "Ya hay muchos pedidos para sumarse a este fondo. Probá en unos días." };
    // Logged out, or logged in with no request of their own.
    for (const viewer of [null, ME]) expect(invitationFor(fund("live", 4), viewer, es, undefined, MAX_OPEN_JOIN_REQUESTS)).toEqual(refusal);
    // Just under the cap there is still room for one more.
    expect(invitationFor(fund("live", 4), null, es, undefined, MAX_OPEN_JOIN_REQUESTS - 1)).toEqual({ kind: "request", again: false });
    // An expired request of their own doesn't get "Pedir de nuevo": it would be refused all the same.
    expect(invitationFor(fund("live", 4), ME, es, { request: EXPIRED, proposal: null }, MAX_OPEN_JOIN_REQUESTS)).toEqual(refusal);
  });

  it("keeps the other states ahead of the 5-request refusal: a member, a full fund, a proposal and your own open request", () => {
    const others = MAX_OPEN_JOIN_REQUESTS;
    expect(invitationFor(fund("live", 4, true), ME, es, undefined, others)).toMatchObject({ why: "Este fondo ya está andando.", link: { href: `/f/${FUND}` } });
    expect(invitationFor(fund("live", 10), ME, es, undefined, others)).toEqual({ kind: "closed", why: "El fondo ya tiene 10 miembros, que es el máximo." });
    expect(invitationFor(fund("live", 4), ME, es, { request: OPEN, proposal: PROPOSED }, others)).toEqual({ kind: "closed", why: "Ana propuso sumarte. Lleva 1 de 2 votos." });
    expect(invitationFor(fund("live", 4), ME, es, { request: EXPIRED, proposal: PROPOSED }, others)).toMatchObject({ why: "Ana propuso sumarte. Lleva 1 de 2 votos." });
    // Your own request is one of the open ones, not "another person's": you still see where it stands.
    expect(invitationFor(fund("live", 4), ME, es, { request: OPEN, proposal: null }, others)).toMatchObject({ why: expect.stringMatching(/^Pediste sumarte\./) });
  });

  it("says the 5-request refusal in English", () => {
    expect(invitationFor(fund("live", 4), null, en, undefined, MAX_OPEN_JOIN_REQUESTS)).toEqual({
      kind: "closed",
      why: "Many people are already asking to join this fund. Try again in a few days.",
    });
    expect(invitationFor(fund("live", 4), ME, en, { request: EXPIRED, proposal: null }, MAX_OPEN_JOIN_REQUESTS)).toMatchObject({ kind: "closed" });
    expect(invitationFor(fund("live", 4), ME, en, { request: OPEN, proposal: null }, MAX_OPEN_JOIN_REQUESTS)).toMatchObject({
      why: expect.stringMatching(/^You asked to join\./),
    });
  });

  it("says each of them in English", () => {
    expect(invitationFor(fund("live", 4), ME, en, { request: OPEN, proposal: null })).toEqual({
      kind: "closed",
      why: "You asked to join. Someone in the group has to propose you, and then it's voted on. Once it's approved, you'll see the fund here.",
    });
    expect(invitationFor(fund("live", 4), ME, en, { request: OPEN, proposal: PROPOSED })).toMatchObject({ why: "Ana proposed adding you. It has 1 of 2 votes." });
    expect(invitationFor(fund("live", 4), ME, en, { request: EXPIRED, proposal: null })).toMatchObject({
      why: "Your request expired. Ask someone in the group to propose you.",
    });
    expect([en.invitation.request, en.invitation.requestAgain]).toEqual(["Ask to join", "Ask again"]);
    expect([es.invitation.request, es.invitation.requestAgain]).toEqual(["Pedir sumarme", "Pedir de nuevo"]);
  });
});

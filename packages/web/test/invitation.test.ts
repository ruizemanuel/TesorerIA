import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DraftSummary } from "../src/lib/funds";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";
import { invitationFor } from "../src/lib/invitation";
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
    expect(invitationFor(fund("live", 4), ME, es)).toEqual({ kind: "closed", why: "Este fondo ya está andando." });
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

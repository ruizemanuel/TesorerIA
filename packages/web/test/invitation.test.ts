import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DraftSummary } from "../src/lib/funds";
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
      expect(invitationFor(fund("draft", 3), viewer)).toEqual({ kind: "join" });
      expect(invitationFor(fund("draft", 9), viewer)).toEqual({ kind: "join" });
    }
    // Someone already in it can always "join" again: it takes them to the draft.
    expect(invitationFor(fund("draft", 10, true), ME)).toEqual({ kind: "join" });
  });

  it("says why there's no joining a draft that is full, being created or already going", () => {
    expect(invitationFor(fund("draft", 10), ME)).toEqual({ kind: "closed", why: "Este fondo ya está completo." });
    expect(invitationFor(fund("deploying", 4), null)).toEqual({ kind: "closed", why: "Este fondo ya se está creando." });
    expect(invitationFor(fund("live", 4), ME)).toEqual({ kind: "closed", why: "Este fondo ya está andando." });
  });

  it("takes someone who is already in it to their fund", () => {
    const deploying = fund("deploying", 4, true);
    expect(invitationFor(deploying, ME)).toEqual({
      kind: "closed",
      why: "Este fondo ya se está creando.",
      link: { href: `/f/borrador/${deploying.id}`, label: "Ir al fondo" },
    });
    expect(invitationFor(fund("live", 4, true), ME)).toEqual({
      kind: "closed",
      why: "Este fondo ya está andando.",
      link: { href: `/f/${FUND}`, label: "Ir al fondo" },
    });
  });
});

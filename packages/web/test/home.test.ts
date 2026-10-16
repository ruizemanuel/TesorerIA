import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { type YourFund, fundTag, homeTarget, yourFunds } from "../src/lib/home";
import { en } from "../src/lib/i18n/en";
import { es } from "../src/lib/i18n/es";

const A = getAddress("0x9A74F670F3c59Ae4B8450fdD477b0461b89D2dfD");
const B = getAddress("0x00000000000000000000000000000000000f00d1");
const GONE = getAddress("0x000000000000000000000000000000000000dEaD");

const live = (id: string, address: string, name = "Fútbol de los jueves") => ({ id, status: "live" as const, address, name });
const draft = (id: string, name = "Asado") => ({ id, status: "draft" as const, address: null, name });
const deploying = (id: string, name = "Pádel") => ({ id, status: "deploying" as const, address: null, name });
const request = (inviteCode: string, fundId = "f-req", name = "Fútbol de los martes") => ({ fundId, name, inviteCode, requestedAt: new Date() });

describe("homeTarget: where the home page takes someone logged in (spec, 9.4 C)", () => {
  it("takes them to the last fund they opened, if they're still in it, even when it isn't the first", () => {
    expect(homeTarget({ funds: [live("1", A), live("2", B)], lastFund: B, requests: [] })).toBe(`/f/${B}`);
  });

  it("reads the cookie in any letter case", () => {
    expect(homeTarget({ funds: [live("1", A), live("2", B)], lastFund: B.toLowerCase(), requests: [] })).toBe(`/f/${B}`);
  });

  it("goes to the first live fund when the cookie is missing, junk, or a fund they're no longer in", () => {
    for (const lastFund of [undefined, "", "nope", "0x123", GONE]) {
      expect(homeTarget({ funds: [live("1", A), live("2", B)], lastFund, requests: [] }), String(lastFund)).toBe(`/f/${A}`);
    }
  });

  it("goes to a live fund before any draft, whatever the order", () => {
    expect(homeTarget({ funds: [draft("d1"), live("1", A)], lastFund: undefined, requests: [] })).toBe(`/f/${A}`);
  });

  it("goes to the first draft when there's no live fund, and to one being created the same way", () => {
    expect(homeTarget({ funds: [draft("d1"), draft("d2")], lastFund: undefined, requests: [] })).toBe("/f/borrador/d1");
    expect(homeTarget({ funds: [deploying("d3")], lastFund: undefined, requests: [] })).toBe("/f/borrador/d3");
  });

  it("goes to the invitation of a request when they're in no fund, the first one it's given (the newest)", () => {
    expect(homeTarget({ funds: [], lastFund: undefined, requests: [request("abc")] })).toBe("/invitacion/abc");
    expect(homeTarget({ funds: [], lastFund: undefined, requests: [request("new", "f-new"), request("old", "f-old")] })).toBe("/invitacion/new");
  });

  it("prefers any fund of theirs, even a draft, to a request", () => {
    expect(homeTarget({ funds: [draft("d1")], lastFund: undefined, requests: [request("abc")] })).toBe("/f/borrador/d1");
  });

  it("leaves them on the home page when there's nothing", () => {
    expect(homeTarget({ funds: [], lastFund: A, requests: [] })).toBeNull();
  });
});

describe("yourFunds: the list in Tu cuenta (spec, 9.4 C)", () => {
  it("marks the fund on screen, with no link, and links the others", () => {
    expect(yourFunds({ funds: [live("1", A), live("2", B, "Pádel")], requests: [], current: A })).toEqual([
      { key: "1", name: "Fútbol de los jueves", href: null, tag: "here" },
      { key: "2", name: "Pádel", href: `/f/${B}`, tag: null },
    ]);
  });

  it("finds the fund on screen in any letter case", () => {
    expect(yourFunds({ funds: [live("1", A)], requests: [], current: getAddress(A).toLowerCase() as `0x${string}` })[0]).toMatchObject({
      href: null,
      tag: "here",
    });
  });

  it("tags drafts, and funds being created, as drafts, linked to the draft's page", () => {
    expect(yourFunds({ funds: [live("1", A), draft("d1"), deploying("d2")], requests: [], current: A }).slice(1)).toEqual([
      { key: "d1", name: "Asado", href: "/f/borrador/d1", tag: "draft" },
      { key: "d2", name: "Pádel", href: "/f/borrador/d2", tag: "draft" },
    ]);
  });

  it("lists open requests last, linked to their invitation, but not one for a fund they're already in", () => {
    const requests = [request("abc", "f-req"), request("xyz", "1", "Fútbol de los jueves")];
    expect(yourFunds({ funds: [live("1", A)], requests, current: A })).toEqual([
      { key: "1", name: "Fútbol de los jueves", href: null, tag: "here" },
      { key: "request:f-req", name: "Fútbol de los martes", href: "/invitacion/abc", tag: "requested" },
    ]);
  });
});

/** A row as the panel shows it: the name, then the tag fundTag gives (the panel only wraps the tag in a span). */
const label = (row: YourFund, m: typeof es) => `${row.name}${fundTag(row, m) ?? ""}`;

describe("the rows of Tus fondos as the panel shows them, in both languages (spec, 9.4 C)", () => {
  it("with a single fund, shows just the one on screen, tagged as the place they are", () => {
    const rows = yourFunds({ funds: [live("1", A)], requests: [], current: A });
    expect(rows.map((row) => label(row, es))).toEqual(["Fútbol de los jueves · estás acá"]);
    expect(rows.map((row) => label(row, en))).toEqual(["Fútbol de los jueves · you're here"]);
  });

  it("with two live funds, tags only the one on screen and shows the other by its name", () => {
    const rows = yourFunds({ funds: [live("1", A), live("2", B, "Pádel")], requests: [], current: B });
    expect(rows.map((row) => label(row, es))).toEqual(["Fútbol de los jueves", "Pádel · estás acá"]);
    expect(rows.map((row) => label(row, en))).toEqual(["Fútbol de los jueves", "Pádel · you're here"]);
  });

  it("tags a draft and an open request after their names", () => {
    const rows = yourFunds({ funds: [live("1", A), draft("d1")], requests: [request("abc")], current: A });
    expect(rows.map((row) => label(row, es))).toEqual([
      "Fútbol de los jueves · estás acá",
      "Asado · borrador",
      "Fútbol de los martes · pediste sumarte",
    ]);
    expect(rows.map((row) => label(row, en))).toEqual([
      "Fútbol de los jueves · you're here",
      "Asado · draft",
      "Fútbol de los martes · you asked to join",
    ]);
  });

  it("says nothing after a fund's name when it has no tag", () => {
    expect(fundTag({ key: "1", name: "Pádel", href: `/f/${B}`, tag: null }, es)).toBeNull();
  });
});

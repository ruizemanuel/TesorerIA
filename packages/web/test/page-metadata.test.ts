import type { Metadata } from "next";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/lib/db/client";
import type { FundView } from "../src/lib/fund-view";
import type { Locale } from "../src/lib/i18n/locales";
import type { FundScreen } from "../src/lib/read-fund";
import { WARS, addLiveFund, addUser, testDb } from "./support/db";

const FUND = getAddress("0x9A74F670F3c59Ae4B8450fdD477b0461b89D2dfD");

const state: { db: Db | null; acceptLanguage: string; reads: string[] } = { db: null, acceptLanguage: "es-AR", reads: [] };

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "accept-language": state.acceptLanguage }),
}));
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => state.db,
}));
// The public screen reads the chain: here it's the real group's fund, public, and no other.
vi.mock("../src/lib/read-fund", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/read-fund")>()),
  loadPublicFundScreen: async (address: string, locale: Locale) => {
    state.reads.push(`${locale}:${address}`);
    return getAddress(address) === FUND ? screen() : null;
  },
}));

const invitation = await import("../src/app/invitacion/[code]/page");
const publicView = await import("../src/app/f/[address]/publico/page");
const publicMovements = await import("../src/app/f/[address]/publico/movimientos/page");
const create = await import("../src/app/crear/page");
const enter = await import("../src/app/entrar/page");

function screen(): FundScreen {
  const view: FundView = {
    address: FUND,
    name: "Fútbol de los jueves",
    agreedExpense: "la cancha",
    closed: false,
    balance: 80_000n * WARS,
    weeklyFee: 10_000n * WARS,
    weeklyCap: 60_000n * WARS,
    spentThisWeek: 0n,
    leftThisWeek: 60_000n * WARS,
    votesRequired: 5,
    week: 2n,
    rows: [],
    me: null,
  };
  return {
    fundId: "fund-1",
    block: 81_300_000n,
    view,
    timeline: [],
    weekSummaries: [],
    invite: null,
    viewerIsMember: false,
    publicView: true,
    contributionOnItsWay: false,
    cashOutOnItsWay: false,
  };
}

const params = <T>(value: T) => ({ params: Promise.resolve(value) });
/** What a chat's link preview reads: the tab's title, and Open Graph's and X's. */
const titles = (metadata: Metadata) => ({
  title: metadata.title,
  openGraph: (metadata.openGraph as { title?: string } | undefined)?.title,
  twitter: (metadata.twitter as { title?: string } | undefined)?.title,
  description: metadata.description,
});

beforeEach(async () => {
  state.db = await testDb();
  state.acceptLanguage = "es-AR";
  state.reads = [];
});

describe("each page's title in the link preview", () => {
  it("names the fund an invitation is to, in the reader's language", async () => {
    const ana = await addUser(state.db!, "Ana");
    const fund = await addLiveFund(state.db!, { creatorId: ana.id, address: FUND, members: [ana.id] });
    expect(titles(await invitation.generateMetadata(params({ code: fund.inviteCode })))).toEqual({
      title: "Te invitaron a Fútbol de los jueves",
      openGraph: "Te invitaron a Fútbol de los jueves · TesorerIA",
      twitter: "Te invitaron a Fútbol de los jueves · TesorerIA",
      description: "Sumate al fondo del grupo en TesorerIA.",
    });
    state.acceptLanguage = "en-US,en;q=0.9";
    expect(titles(await invitation.generateMetadata(params({ code: fund.inviteCode })))).toMatchObject({
      title: "You're invited to Fútbol de los jueves",
      openGraph: "You're invited to Fútbol de los jueves · TesorerIA",
    });
  });

  it("leaves an invitation that doesn't exist to the site's title", async () => {
    expect(await invitation.generateMetadata(params({ code: "nope" }))).toEqual({});
  });

  it("names the fund on its public view and on its public movements, said live", async () => {
    for (const page of [publicView, publicMovements]) {
      expect(titles(await page.generateMetadata(params({ address: FUND.toLowerCase() })))).toEqual({
        title: "Fútbol de los jueves",
        openGraph: "Fútbol de los jueves · TesorerIA",
        twitter: "Fútbol de los jueves · TesorerIA",
        description: "Fútbol de los jueves, en vivo: lo que hay en el fondo, quién pagó la cuota y lo que hizo el agente.",
      });
    }
    // The page's own read, in its language: the same one the page makes, kept for 45 seconds.
    expect(state.reads).toEqual([`es:${FUND.toLowerCase()}`, `es:${FUND.toLowerCase()}`]);
  });

  it("leaves a fund that isn't public, or isn't an address, to the site's title", async () => {
    expect(await publicView.generateMetadata(params({ address: "0x000000000000000000000000000000000000dEaD" }))).toEqual({});
    expect(await publicView.generateMetadata(params({ address: "nope" }))).toEqual({});
    expect(state.reads).toEqual(["es:0x000000000000000000000000000000000000dEaD"]);
  });

  it("titles Crear and Entrar with their headings", async () => {
    expect(titles(await create.generateMetadata())).toMatchObject({ title: "Crear un fondo", openGraph: "Crear un fondo · TesorerIA" });
    expect(titles(await enter.generateMetadata())).toMatchObject({ title: "Entrá a tu fondo", twitter: "Entrá a tu fondo · TesorerIA" });
    state.acceptLanguage = "en";
    expect(titles(await create.generateMetadata())).toMatchObject({ title: "Create a fund", openGraph: "Create a fund · TesorerIA" });
  });
});

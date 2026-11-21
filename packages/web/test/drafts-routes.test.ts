import { FUND_FACTORY_V2, fundFactoryV2Abi } from "@tesoreria/agent";
import { eq } from "drizzle-orm";
import { type Hex, decodeFunctionData, getAddress, zeroAddress } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTRIES } from "../src/lib/countries";
import type { CurrentUser } from "../src/lib/current-user";
import type { Db } from "../src/lib/db/client";
import { funds, operations } from "../src/lib/db/schema";
import { NBSP } from "../src/lib/format";
import { draftById } from "../src/lib/funds";
import { PENDING_FOR_MS, recordOperation } from "../src/lib/operations";
import { addUser, testDb } from "./support/db";
import { WARS } from "./support/fixtures";

// The routes as the server runs them, with the session and the database standing in.
const state = vi.hoisted(() => ({ user: null as CurrentUser | null, db: null as unknown, env: {} as Record<string, string> }));
vi.mock("../src/lib/current-user", () => ({ currentUser: async () => state.user }));
// The server's settings as it reads them from its variables, read again each time so a test can turn Mexico off
// (mockEnv): what this file stubs, and EXTRA_COUNTRIES through the real parser.
vi.mock("../src/lib/env", async (importOriginal) => {
  const { parseEnv } = await importOriginal<typeof import("../src/lib/env")>();
  return { parseEnv, env: () => parseEnv({ ...process.env, ...state.env }) };
});
const mockEnv = (env: Record<string, string>) => {
  state.env = env;
};
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => state.db,
}));
// Celo, where every account's EntryPoint nonce is 5, and no operation has landed.
vi.mock("../src/lib/chain", () => ({ celoClient: () => ({ readContract: async () => 5n }), userOperationFinder: () => async () => null }));

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

let db: Db;
let people: CurrentUser[];
let createDraftRoute: (request: Request) => Promise<Response>;
let join: Handler;
let deploy: Handler;
let cancel: Handler;
let deployed: Handler;

const json = (body: unknown, method = "POST") =>
  new Request("http://localhost:3000/api", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (values: Record<string, string>) => ({ params: Promise.resolve(values) });
const asUser = (user: { id: string; name: string; account: string }): CurrentUser => ({ id: user.id, name: user.name, account: getAddress(user.account) });
const DRAFT = { name: "Fútbol de los jueves", agreedExpense: "la cancha", weeklyFee: "10.000", weeklyCap: "60.000" };
/** Each country's currency: what a draft keeps its money in. */
const [ARS, MXN] = [COUNTRIES.AR.currency.token, COUNTRIES.MX.currency.token];

async function draftOfThree() {
  state.user = people[0]!;
  const { id } = (await (await createDraftRoute(json(DRAFT))).json()) as { id: string };
  const { inviteCode } = (await draftById(db, id))!;
  for (const person of people.slice(1)) {
    state.user = person;
    await join(json({}), params({ code: inviteCode }));
  }
  state.user = people[0]!;
  return id;
}

beforeAll(async () => {
  vi.stubEnv("CHAIN_MODE", "fork");
  vi.stubEnv("RP_ID", "localhost");
  vi.stubEnv("ORIGIN", "http://localhost:3000");
  vi.stubEnv("SESSION_SECRET", "a-session-secret-for-tests-only-0123456789");
  db = await testDb();
  state.db = db;
  people = [asUser(await addUser(db, "Ana")), asUser(await addUser(db, "Beto")), asUser(await addUser(db, "Caro"))];
  ({ POST: createDraftRoute } = await import("../src/app/api/drafts/route"));
  ({ POST: join } = (await import("../src/app/api/invites/[code]/join/route")) as unknown as { POST: Handler });
  ({ POST: deploy, DELETE: cancel } = (await import("../src/app/api/drafts/[id]/deploy/route")) as unknown as { POST: Handler; DELETE: Handler });
  ({ POST: deployed } = (await import("../src/app/api/drafts/[id]/deployed/route")) as unknown as { POST: Handler });
});
beforeEach(() => {
  state.user = people[0]!;
  // Mexico on, as a local run turns it on: a draft asks for it (country), and a request from there (x-vercel-ip-country) sees it.
  mockEnv({ EXTRA_COUNTRIES: "MX" });
});

describe("POST /api/drafts", () => {
  it("answers 401 to someone who is not logged in", async () => {
    state.user = null;
    expect((await createDraftRoute(json(DRAFT))).status).toBe(401);
  });

  it("teaches the way to write an amount it can't read, and refuses one nobody means", async () => {
    const answer = async (change: Partial<typeof DRAFT>) => {
      const response = await createDraftRoute(json({ ...DRAFT, ...change }));
      return { status: response.status, ...((await response.json()) as { error?: string }) };
    };
    expect(await answer({ weeklyFee: "10,000.50" })).toEqual({ status: 400, error: "No entendimos la cuota. Escribila como 10.000 o 10.000,50." });
    expect(await answer({ weeklyCap: "1.0000" })).toEqual({ status: 400, error: "No entendimos el tope. Escribilo como 60.000 o 60.000,50." });
    expect(await answer({ weeklyFee: "1.000.000.000.001" })).toEqual({ status: 400, error: "La cuota no puede pasar de $ 1.000.000.000.000." });
  });

  it("refuses a weekly cap above the fund's cap, which a fund of its own would revert", async () => {
    const response = await createDraftRoute(json({ ...DRAFT, weeklyCap: "450.001" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: `El tope semanal no puede pasar el tope del fondo, de $${NBSP}450.000.` });
    expect((await createDraftRoute(json({ ...DRAFT, weeklyCap: "450.000" }))).status).toBe(200);
  });

  it("creates the draft, with its creator in it", async () => {
    const response = await createDraftRoute(json({ ...DRAFT, weeklyFee: "$ 10.000,50" }));
    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };
    expect(await draftById(db, id)).toMatchObject({ weeklyFee: 10_000_500_000_000_000_000_000n, members: [{ userId: people[0]!.id }] });
  });

  it("refuses a country that isn't offered, and creates one that is", async () => {
    const answer = async (response: Response) => ({ status: response.status, ...((await response.json()) as { error?: string; id?: string }) });
    const mexican = { country: "MX", weeklyFee: "100", weeklyCap: "600", name: "F", agreedExpense: "c" };
    mockEnv({});
    expect(await answer(await createDraftRoute(json(mexican)))).toEqual({ status: 400, error: "Todavía no se pueden crear fondos de ese país." });
    // A country the web has no table for isn't one it could offer.
    expect(await answer(await createDraftRoute(json({ ...mexican, country: "BR" })))).toEqual({ status: 400, error: "Faltan datos o no son válidos." });
    mockEnv({ EXTRA_COUNTRIES: "MX" });
    const response = await createDraftRoute(json({ ...mexican, weeklyCap: "1,000" }));
    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };
    expect(await draftById(db, id)).toMatchObject({ currency: MXN, balanceCap: 5_000n * WARS, weeklyFee: 100n * WARS, weeklyCap: 1_000n * WARS });
  });

  it("keeps creating Argentine drafts when the body has no country", async () => {
    const response = await createDraftRoute(json({ weeklyFee: "10.000", weeklyCap: "60.000", name: "F", agreedExpense: "c" }));
    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };
    expect(await draftById(db, id)).toMatchObject({ currency: ARS, balanceCap: 450_000n * WARS, weeklyFee: 10_000n * WARS, weeklyCap: 60_000n * WARS });
  });
});

describe("the invitation and the deploy", () => {
  it("joins only by JSON, and only someone logged in", async () => {
    const id = await draftOfThree();
    const { inviteCode } = (await draftById(db, id))!;
    state.user = null;
    expect((await join(json({}), params({ code: inviteCode }))).status).toBe(401);
    state.user = people[1]!;
    const form = new Request("http://localhost:3000/api", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" });
    expect((await join(form, params({ code: inviteCode }))).status).toBe(415);
    expect(await (await join(json({}), params({ code: inviteCode }))).json()).toEqual({ ok: true, fundId: id, status: "draft", address: null });
  });

  it("gives the creator the call to sign, and opens the draft again when it doesn't go out", async () => {
    const id = await draftOfThree();
    state.user = people[1]!;
    expect((await deploy(json({ votesRequired: 2 }), params({ id }))).status).toBe(403);
    state.user = people[0]!;
    const step = (await (await deploy(json({ votesRequired: 2 }), params({ id }))).json()) as { call?: { to: string } };
    expect(step.call?.to).toBe(FUND_FACTORY_V2);
    expect((await draftById(db, id))?.status).toBe("deploying");

    expect(await (await cancel(new Request("http://localhost:3000/api", { method: "DELETE" }), params({ id }))).json()).toEqual({ reopened: true });
    expect((await draftById(db, id))?.status).toBe("draft");
  });

  it("sends the nonce a resend is pinned to as a decimal string", async () => {
    const id = await draftOfThree();
    await deploy(json({ votesRequired: 2 }), params({ id }));
    const userOpHash = `0x${"0b".repeat(32)}` as const;
    await recordOperation(db, people[0]!.id, { userOpHash, kind: "create-fund", draftId: id, nonce: 5n });
    await db.update(operations).set({ createdAt: new Date(Date.now() - PENDING_FOR_MS - 60_000) });
    const response = await deploy(json({ votesRequired: 2 }), params({ id }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, call: { to: FUND_FACTORY_V2 }, nonce: "5" });
  });

  it("answers 404 to an id that isn't one, and 400 to a transaction that isn't a hash", async () => {
    expect((await deploy(json({ votesRequired: 2 }), params({ id: "nope" }))).status).toBe(404);
    const id = await draftOfThree();
    expect((await deployed(json({ transactionHash: "0x1234" }), params({ id }))).status).toBe(400);
  });
});

describe("in the language of the request", () => {
  const english = (body: unknown, method = "POST") =>
    new Request("http://localhost:3000/api", { method, headers: { "content-type": "application/json", cookie: "lang=en" }, body: JSON.stringify(body) });
  const answer = async (response: Response) => ({ status: response.status, ...((await response.json()) as { error?: string }) });

  it("asks for a login, teaches how to write an amount, and reads amounts the English way", async () => {
    state.user = null;
    expect(await answer(await createDraftRoute(english(DRAFT)))).toEqual({ status: 401, error: "Log in with your passkey." });
    state.user = people[0]!;
    expect(await answer(await createDraftRoute(english(DRAFT)))).toEqual({
      status: 400,
      error: "We couldn't read the weekly dues. Write them like 10,000 or 10,000.50.",
    });
    expect(await answer(await createDraftRoute(english({ ...DRAFT, weeklyFee: "10,000", weeklyCap: "1,000,000,000,001" })))).toEqual({
      status: 400,
      error: `The weekly cap can't be more than ARS${NBSP}1,000,000,000,000.`,
    });
    expect(await answer(await createDraftRoute(english({ ...DRAFT, weeklyFee: "10,000", weeklyCap: "450,001" })))).toEqual({
      status: 400,
      error: `The weekly cap can't be above the fund's cap of ARS${NBSP}450,000.`,
    });
    const created = await createDraftRoute(english({ ...DRAFT, weeklyFee: "ARS 10,000.50", weeklyCap: "60,000" }));
    const { id } = (await created.json()) as { id: string };
    expect(await draftById(db, id)).toMatchObject({ weeklyFee: 10_000n * WARS + WARS / 2n, weeklyCap: 60_000n * WARS });
  });

  it("answers the invitation and the deploy in English", async () => {
    expect(await answer(await join(english({}), params({ code: "nope" })))).toEqual({ status: 404, error: "That invitation link isn't valid." });
    const id = await draftOfThree();
    state.user = people[1]!;
    expect(await answer(await deploy(english({ votesRequired: 2 }), params({ id })))).toEqual({
      status: 403,
      error: "Only the person who set up the fund can create it.",
    });
    expect(await answer(await deploy(english({ votesRequired: 2 }), params({ id: "nope" })))).toEqual({ status: 404, error: "We couldn't find that fund." });
    expect(await answer(await cancel(english(undefined, "DELETE"), params({ id })))).toEqual({
      status: 403,
      error: "Only the person who set up the fund can create it.",
    });
    expect(await answer(await deployed(english({ transactionHash: "0x1234" }), params({ id })))).toEqual({
      status: 400,
      error: "Some details are missing or aren't valid.",
    });
    state.user = null;
    expect(await answer(await deployed(english({ transactionHash: "0x1234" }), params({ id })))).toEqual({ status: 401, error: "Log in with your passkey." });
  });
});

describe("in the draft's country, and outside one in the IP's (spec, 6)", () => {
  /** A browser in Mexico: Vercel says so in x-vercel-ip-country, and this run offers Mexico (EXTRA_COUNTRIES). */
  const fromMexico = (body: unknown) =>
    new Request("http://localhost:3000/api", { method: "POST", headers: { "content-type": "application/json", "x-vercel-ip-country": "MX" }, body: JSON.stringify(body) });
  const answer = async (response: Response) => ({ status: response.status, ...((await response.json()) as { error?: string }) });

  it("answers a draft's deploy and invitation in the draft's Spanish, not the IP's", async () => {
    const id = await draftOfThree();
    const { inviteCode } = (await draftById(db, id))!;
    state.user = asUser(await addUser(db, "Dani"));
    await join(json({}), params({ code: inviteCode }));
    state.user = people[0]!;
    expect((await deploy(json({ votesRequired: 2 }), params({ id }))).status).toBe(200);
    // An Argentine draft speaks Rioplatense to a browser in Mexico.
    expect(await answer(await deploy(fromMexico({ votesRequired: 3 }), params({ id })))).toEqual({
      status: 409,
      error: "Ya empezaste a crear el fondo con 2 votos necesarios: elegí 2 para seguir.",
    });
    // The same draft in wMXN speaks neutral Spanish to anyone.
    await db.update(funds).set({ currency: MXN }).where(eq(funds.id, id));
    expect(await answer(await deploy(json({ votesRequired: 3 }), params({ id })))).toEqual({
      status: 409,
      error: "Ya empezaste a crear el fondo con 2 votos necesarios: elige 2 para continuar.",
    });
    state.user = asUser(await addUser(db, "Eli"));
    expect(await answer(await join(json({}), params({ code: inviteCode })))).toEqual({
      status: 409,
      error: "El fondo se está creando en este momento. Inténtalo en un rato.",
    });
  });

  it("reads a new draft's amounts as the country it's for writes them: the one its form sends, not the IP's", async () => {
    // /crear sends the country the group is from (country), and its form writes the amounts the way that country does.
    const mexican = { ...DRAFT, country: "MX" };
    expect(await answer(await createDraftRoute(fromMexico(mexican)))).toEqual({
      status: 400,
      error: "No entendimos la cuota. Escríbela como 10,000 o 10,000.50.",
    });
    expect(await answer(await createDraftRoute(fromMexico({ ...mexican, weeklyFee: "1,000.50", weeklyCap: "6,000" })))).toEqual({
      status: 400,
      error: "El tope semanal no puede superar el tope del fondo, de $5,000.",
    });
    const created = await createDraftRoute(fromMexico({ ...mexican, weeklyFee: "1,000.50", weeklyCap: "5,000" }));
    const { id } = (await created.json()) as { id: string };
    expect(await draftById(db, id)).toMatchObject({ currency: MXN, weeklyFee: 1_000n * WARS + WARS / 2n, weeklyCap: 5_000n * WARS });
    // A body without one is an Argentine draft, written the Rioplatense way, wherever the browser is.
    const argentine = await createDraftRoute(fromMexico(DRAFT));
    expect(argentine.status).toBe(200);
    const { id: arId } = (await argentine.json()) as { id: string };
    expect(await draftById(db, arId)).toMatchObject({ currency: ARS, weeklyFee: 10_000n * WARS, weeklyCap: 60_000n * WARS });
  });

  it("lets a Mexican draft made while Mexico was offered be joined and created once it isn't", async () => {
    const created = await createDraftRoute(json({ ...DRAFT, country: "MX", weeklyFee: "100", weeklyCap: "600" }));
    const { id } = (await created.json()) as { id: string };
    mockEnv({});
    const { inviteCode } = (await draftById(db, id))!;
    for (const person of people.slice(1)) {
      state.user = person;
      expect((await join(json({}), params({ code: inviteCode }))).status).toBe(200);
    }
    state.user = people[0]!;
    const response = await deploy(json({ votesRequired: 2 }), params({ id }));
    expect(response.status).toBe(200);
    const { call } = (await response.json()) as { call: { to: string; data: Hex } };
    expect(call.to).toBe(FUND_FACTORY_V2);
    const { args } = decodeFunctionData({ abi: fundFactoryV2Abi, data: call.data });
    expect(args[0]).toMatchObject({ currency: MXN, dollar: zeroAddress, pool: zeroAddress, balanceCap: 5_000n * WARS, weeklyCap: 600n * WARS });
  });
});

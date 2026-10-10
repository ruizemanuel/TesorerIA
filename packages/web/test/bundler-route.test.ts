import { getAddress, numberToHex } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "../src/lib/current-user";
import type { Db } from "../src/lib/db/client";
import { addLiveFund, addUser, randomAccount, testDb } from "./support/db";

// The route as the server runs it, with the session and the database standing in, and Pimlico's answer faked.
const KEY = "pim_test_key_8b1f";
const POLICY = "sp_server_policy";
const state = vi.hoisted(() => ({ user: null as CurrentUser | null, db: null as unknown }));
vi.mock("../src/lib/current-user", () => ({ currentUser: async () => state.user }));
vi.mock("../src/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/db/client")>()),
  getDb: async () => state.db,
}));

const CELO = numberToHex(42220);
const op = (sender: string) => ({ sender, nonce: "0x0", callData: "0x" });
const rpc = (method: string, params: unknown[] = []) => ({ jsonrpc: "2.0", id: 5, method, params });

let POST: (request: Request) => Promise<Response>;
let member: CurrentUser;
let stranger: CurrentUser;
const pimlico = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

beforeAll(async () => {
  vi.stubEnv("CHAIN_MODE", "mainnet");
  vi.stubEnv("RP_ID", "localhost");
  vi.stubEnv("ORIGIN", "http://localhost:3000");
  vi.stubEnv("SESSION_SECRET", "a-session-secret-for-tests-only-0123456789");
  vi.stubEnv("DATABASE_URL", "memory");
  vi.stubEnv("PIMLICO_API_KEY", KEY);
  vi.stubEnv("PIMLICO_SPONSORSHIP_POLICY_ID", POLICY);
  const db: Db = await testDb();
  state.db = db;
  const ana = await addUser(db, "Ana");
  const outsider = await addUser(db, "Outsider");
  await addLiveFund(db, { creatorId: ana.id, address: randomAccount(), members: [ana.id] });
  member = { id: ana.id, name: ana.name, account: getAddress(ana.account) };
  stranger = { id: outsider.id, name: outsider.name, account: getAddress(outsider.account) };
  ({ POST } = await import("../src/app/api/bundler/route"));
});
beforeEach(() => {
  state.user = member;
  vi.stubGlobal("fetch", pimlico);
  pimlico.mockImplementation(async () => Response.json({ jsonrpc: "2.0", id: 5, result: CELO }));
});
afterEach(() => {
  vi.clearAllMocks();
});

function call(body: unknown, contentType = "application/json") {
  return POST(new Request("http://localhost:3000/api/bundler", { method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(body) }));
}

describe("POST /api/bundler", () => {
  it("answers 401 to someone who is not logged in, and asks Pimlico nothing", async () => {
    state.user = null;
    const response = await call(rpc("eth_chainId"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", id: 5, error: { message: "Log in first" } });
    expect(pimlico).not.toHaveBeenCalled();
  });

  it("answers 403 to a logged-in person who belongs to no fund, even for a request that is fine", async () => {
    state.user = stranger;
    const response = await call(rpc("eth_sendUserOperation", [op(stranger.account), entryPoint07Address]));
    expect(response.status).toBe(403);
    expect(pimlico).not.toHaveBeenCalled();
  });

  it("answers 403 and 400 to another account's operation, a method off the list, other chains and batches", async () => {
    const other = getAddress("0x6BE3c1eB63A4edbc6C23c281F93F81B14eF3a671");
    const cases: [unknown, number][] = [
      [rpc("eth_sendUserOperation", [op(other), entryPoint07Address]), 403],
      [rpc("pm_getPaymasterData", [op(other), entryPoint07Address, CELO, {}]), 403],
      [rpc("eth_sendRawTransaction", ["0x00"]), 403],
      [rpc("pm_getPaymasterData", [op(member.account), entryPoint07Address, numberToHex(1), {}]), 400],
      [[rpc("eth_chainId"), rpc("eth_chainId")], 400],
    ];
    for (const [body, status] of cases) expect((await call(body)).status, JSON.stringify(body)).toBe(status);
    expect((await call("not a request")).status).toBe(400);
    expect(pimlico).not.toHaveBeenCalled();
  });

  it("sends a member's own request with the key, and with the server's policy instead of the one they sent", async () => {
    const response = await call(rpc("pm_getPaymasterStubData", [op(member.account), entryPoint07Address, CELO, { sponsorshipPolicyId: "sp_mine" }]));
    expect(response.status).toBe(200);
    expect(pimlico).toHaveBeenCalledTimes(1);
    const [url, init] = pimlico.mock.calls[0]!;
    expect(url).toBe(`https://api.pimlico.io/v2/42220/rpc?apikey=${KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({
      jsonrpc: "2.0",
      id: 5,
      method: "pm_getPaymasterStubData",
      params: [op(member.account), entryPoint07Address, CELO, { sponsorshipPolicyId: POLICY }],
    });
  });

  it("never lets the key out, in an answer or in a failure", async () => {
    const ok = await call(rpc("eth_chainId"));
    expect(JSON.stringify([...ok.headers])).not.toContain(KEY);
    expect(await ok.text()).not.toContain(KEY);

    pimlico.mockRejectedValue(new TypeError(`fetch failed: https://api.pimlico.io/v2/42220/rpc?apikey=${KEY}`));
    const failed = await call(rpc("eth_chainId"));
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain(KEY);
  });
});

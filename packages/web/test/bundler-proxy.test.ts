import { getAddress, numberToHex } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { describe, expect, it } from "vitest";
import { authorizeBundlerRequest, checkBundlerRequest } from "../src/lib/bundler-proxy";
import { funds, memberships } from "../src/lib/db/schema";
import { addLiveFund, addUser, randomAccount, testDb } from "./support/db";

const ME = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");
const OTHER = getAddress("0x6BE3c1eB63A4edbc6C23c281F93F81B14eF3a671");
const CELO = numberToHex(42220);
const POLICY = "sp_server";
const op = (sender: string) => ({ sender, nonce: "0x0", callData: "0x" });
const rpc = (method: string, params: unknown[] = []) => ({ jsonrpc: "2.0", id: 1, method, params });

describe("checkBundlerRequest", () => {
  it("lets a logged-in member send and sponsor their own operations, with the server's policy", () => {
    expect(checkBundlerRequest(rpc("eth_sendUserOperation", [op(ME), entryPoint07Address]), ME, POLICY)).toEqual({
      ok: true,
      request: { jsonrpc: "2.0", id: 1, method: "eth_sendUserOperation", params: [op(ME), entryPoint07Address] },
    });
    const stub = checkBundlerRequest(
      rpc("pm_getPaymasterStubData", [op(ME.toLowerCase()), entryPoint07Address, CELO, { sponsorshipPolicyId: "sp_mine" }]),
      ME,
      POLICY,
    );
    expect(stub).toMatchObject({ ok: true, request: { params: [op(ME.toLowerCase()), entryPoint07Address, CELO, { sponsorshipPolicyId: POLICY }] } });
    expect(checkBundlerRequest(rpc("eth_getUserOperationReceipt", ["0x01"]), ME, POLICY).ok).toBe(true);
    expect(checkBundlerRequest(rpc("pimlico_getUserOperationGasPrice"), ME, POLICY).ok).toBe(true);
  });

  it("refuses strangers, other accounts' operations, other methods, other chains and batches", () => {
    expect(checkBundlerRequest(rpc("eth_chainId"), null, POLICY)).toMatchObject({ ok: false, status: 401 });
    expect(checkBundlerRequest(rpc("eth_sendUserOperation", [op(OTHER), entryPoint07Address]), ME, POLICY)).toMatchObject({ ok: false, status: 403 });
    expect(checkBundlerRequest(rpc("eth_sendUserOperation", [op("not an address"), entryPoint07Address]), ME, POLICY)).toMatchObject({ ok: false, status: 403 });
    expect(checkBundlerRequest(rpc("eth_sendUserOperation", [op(ME), OTHER]), ME, POLICY)).toMatchObject({ ok: false, status: 400 });
    for (const method of ["eth_sendRawTransaction", "pimlico_sendUserOperationNow", "pm_sponsorUserOperation", "eth_call"]) {
      expect(checkBundlerRequest(rpc(method), ME, POLICY), method).toMatchObject({ ok: false, status: 403 });
    }
    const otherChain = rpc("pm_getPaymasterData", [op(ME), entryPoint07Address, numberToHex(1), {}]);
    expect(checkBundlerRequest(otherChain, ME, POLICY)).toMatchObject({ ok: false, status: 400 });
    expect(checkBundlerRequest([rpc("eth_chainId")], ME, POLICY)).toMatchObject({ ok: false, status: 400 });
    expect(checkBundlerRequest("eth_chainId", ME, POLICY)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("authorizeBundlerRequest", () => {
  const send = (account: string) => rpc("eth_sendUserOperation", [op(account), entryPoint07Address]);
  /** What `currentUser` gives: the account checksummed. */
  const asUser = (user: { id: string; account: string }) => ({ id: user.id, account: getAddress(user.account) });

  it("sponsors only people who belong to a fund, draft or live", async () => {
    const db = await testDb();
    const stranger = await addUser(db, "Stranger");
    const creator = await addUser(db, "Ana");
    const member = await addUser(db, "Juan");
    await addLiveFund(db, { creatorId: creator.id, address: randomAccount(), members: [member.id] });
    const [draft] = await db
      .insert(funds)
      .values({ name: "Draft", agreedExpense: "x", weeklyFee: 1n, weeklyCap: 1n, balanceCap: 1n, creatorId: creator.id, inviteCode: "draft-code" })
      .returning();
    const founder = await addUser(db, "Founder");
    await db.insert(memberships).values({ fundId: draft!.id, userId: founder.id });

    expect(await authorizeBundlerRequest(db, null, send(ME), POLICY)).toMatchObject({ ok: false, status: 401 });
    expect(await authorizeBundlerRequest(db, asUser(stranger), send(stranger.account), POLICY)).toMatchObject({ ok: false, status: 403 });
    for (const person of [member, founder]) {
      const result = await authorizeBundlerRequest(db, asUser(person), send(person.account), POLICY);
      expect(result, person.name).toMatchObject({ ok: true, request: { params: [op(person.account), entryPoint07Address] } });
    }
  });

  it("still applies every other rule to a member", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    await addLiveFund(db, { creatorId: ana.id, address: randomAccount(), members: [ana.id] });
    expect(await authorizeBundlerRequest(db, asUser(ana), send(OTHER), POLICY)).toMatchObject({ ok: false, status: 403 });
    expect(await authorizeBundlerRequest(db, asUser(ana), rpc("eth_call"), POLICY)).toMatchObject({ ok: false, status: 403 });
    expect(await authorizeBundlerRequest(db, asUser(ana), [send(ana.account)], POLICY)).toMatchObject({ ok: false, status: 400 });
  });
});

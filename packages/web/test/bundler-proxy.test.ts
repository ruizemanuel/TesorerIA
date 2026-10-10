import { ATTRIBUTION_SUFFIX } from "@tesoreria/wallet";
import { concat, getAddress, numberToHex } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_FEE_MULTIPLE,
  MAX_OPERATION_GAS,
  authorizeBundlerRequest,
  checkBundlerRequest,
  checkSponsoredGas,
} from "../src/lib/bundler-proxy";
import { funds, memberships } from "../src/lib/db/schema";
import { addLiveFund, addUser, randomAccount, testDb } from "./support/db";

const ME = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");
const OTHER = getAddress("0x6BE3c1eB63A4edbc6C23c281F93F81B14eF3a671");
const CELO = numberToHex(42220);
const POLICY = "sp_server";
const op = (sender: string, callData: string = ATTRIBUTION_SUFFIX) => ({ sender, nonce: "0x0", callData });
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

  it("sends or sponsors only an operation that ends with TesorerIA's attribution tag", () => {
    const CALL = "0xb61d27f6";
    for (const method of ["eth_sendUserOperation", "pm_getPaymasterData"]) {
      const params = (callData: unknown) => [{ ...op(ME), callData }, entryPoint07Address, CELO, {}];
      expect(checkBundlerRequest(rpc(method, params(concat([CALL, ATTRIBUTION_SUFFIX]))), ME, POLICY).ok, method).toBe(true);
      const shouted = concat([CALL, ATTRIBUTION_SUFFIX]).replace(/[a-f]/g, (letter) => letter.toUpperCase());
      expect(checkBundlerRequest(rpc(method, params(shouted)), ME, POLICY).ok, `${method}, in upper case`).toBe(true);
      for (const callData of ["0x", CALL, concat([ATTRIBUTION_SUFFIX, CALL]), undefined, 7]) {
        expect(checkBundlerRequest(rpc(method, params(callData)), ME, POLICY), `${method}: ${String(callData)}`).toMatchObject({
          ok: false,
          status: 400,
          error: "The operation must end with TesorerIA's attribution tag",
        });
      }
    }
  });
});

const FAST = 5_000_000_000n; // Pimlico's current "fast" maxFeePerGas: 5 gwei
const hex = (value: bigint) => numberToHex(value);
/** A prepared operation as viem sends it to pm_getPaymasterData, at the edge of every ceiling unless changed. */
const sponsored = (sender: string, change: Record<string, unknown> = {}) => ({
  ...op(sender),
  maxFeePerGas: hex(MAX_FEE_MULTIPLE * FAST),
  maxPriorityFeePerGas: hex(MAX_FEE_MULTIPLE * FAST),
  callGasLimit: hex(8_000_000n),
  verificationGasLimit: hex(1_500_000n),
  preVerificationGas: hex(400_000n),
  paymasterVerificationGasLimit: hex(50_000n),
  paymasterPostOpGasLimit: hex(50_000n),
  ...change,
});

describe("checkSponsoredGas", () => {
  it("accepts an operation right at the ceilings, with or without the paymaster's own limits", () => {
    expect(8_000_000n + 1_500_000n + 400_000n + 50_000n + 50_000n).toBe(MAX_OPERATION_GAS);
    expect(checkSponsoredGas(sponsored(ME), FAST)).toEqual({ ok: true });
    const { paymasterVerificationGasLimit, paymasterPostOpGasLimit, ...bare } = sponsored(ME);
    expect(checkSponsoredGas(bare, FAST)).toEqual({ ok: true });
    expect(checkSponsoredGas(sponsored(ME, { maxFeePerGas: hex(FAST), maxPriorityFeePerGas: hex(1n) }), FAST)).toEqual({ ok: true });
  });

  it("refuses a fee above twice Pimlico's current price, or a tip above the fee", () => {
    const high = hex(MAX_FEE_MULTIPLE * FAST + 1n);
    expect(checkSponsoredGas(sponsored(ME, { maxFeePerGas: high, maxPriorityFeePerGas: hex(1n) }), FAST)).toMatchObject({ ok: false, status: 400 });
    expect(checkSponsoredGas(sponsored(ME, { maxFeePerGas: hex(FAST), maxPriorityFeePerGas: hex(FAST + 1n) }), FAST)).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses limits that add up to more than the ceiling, the paymaster's included", () => {
    expect(checkSponsoredGas(sponsored(ME, { callGasLimit: hex(8_000_001n) }), FAST)).toMatchObject({ ok: false, status: 400 });
    expect(checkSponsoredGas(sponsored(ME, { verificationGasLimit: hex(1_500_001n) }), FAST)).toMatchObject({ ok: false, status: 400 });
    expect(checkSponsoredGas(sponsored(ME, { preVerificationGas: hex(400_001n) }), FAST)).toMatchObject({ ok: false, status: 400 });
    expect(checkSponsoredGas(sponsored(ME, { paymasterVerificationGasLimit: hex(50_001n) }), FAST)).toMatchObject({ ok: false, status: 400 });
    expect(checkSponsoredGas(sponsored(ME, { paymasterPostOpGasLimit: hex(50_001n) }), FAST)).toMatchObject({ ok: false, status: 400 });
    expect(checkSponsoredGas(sponsored(ME, { callGasLimit: hex(2n ** 255n) }), FAST)).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a field that is missing or not a hex quantity, so nothing is signed unread", () => {
    const required = ["maxFeePerGas", "maxPriorityFeePerGas", "callGasLimit", "verificationGasLimit", "preVerificationGas"];
    for (const name of required) {
      expect(checkSponsoredGas(sponsored(ME, { [name]: undefined }), FAST), `${name} missing`).toMatchObject({ ok: false, status: 400 });
    }
    for (const name of [...required, "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"]) {
      for (const value of ["1000", "0x", "0xzz", "-0x1", 1000, null, `0x${"f".repeat(65)}`]) {
        expect(checkSponsoredGas(sponsored(ME, { [name]: value }), FAST), `${name}: ${String(value)}`).toMatchObject({ ok: false, status: 400 });
      }
    }
    expect(checkSponsoredGas("not an operation", FAST)).toMatchObject({ ok: false, status: 400 });
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

  const sponsor = (account: string, change: Record<string, unknown> = {}) =>
    rpc("pm_getPaymasterData", [sponsored(account, change), entryPoint07Address, CELO, { sponsorshipPolicyId: "sp_mine" }]);

  it("holds a sponsoring request to the current price, which it reads only when it has to", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    await addLiveFund(db, { creatorId: ana.id, address: randomAccount(), members: [ana.id] });
    const stranger = await addUser(db, "Stranger");
    const price = vi.fn(async () => FAST);

    const ok = await authorizeBundlerRequest(db, asUser(ana), sponsor(ana.account), POLICY, price);
    expect(ok).toMatchObject({ ok: true, request: { params: [sponsored(ana.account), entryPoint07Address, CELO, { sponsorshipPolicyId: POLICY }] } });
    expect(price).toHaveBeenCalledTimes(1);
    const high = { maxFeePerGas: hex(MAX_FEE_MULTIPLE * FAST + 1n) };
    expect(await authorizeBundlerRequest(db, asUser(ana), sponsor(ana.account, high), POLICY, price)).toMatchObject({ ok: false, status: 400 });
    const heavy = { callGasLimit: hex(MAX_OPERATION_GAS) };
    expect(await authorizeBundlerRequest(db, asUser(ana), sponsor(ana.account, heavy), POLICY, price)).toMatchObject({ ok: false, status: 400 });

    price.mockClear();
    const answers = await Promise.all([
      authorizeBundlerRequest(db, null, sponsor(ana.account), POLICY, price), // logged out
      authorizeBundlerRequest(db, asUser(stranger), sponsor(stranger.account), POLICY, price), // no fund
      authorizeBundlerRequest(db, asUser(ana), sponsor(OTHER), POLICY, price), // someone else's operation
      authorizeBundlerRequest(db, asUser(ana), rpc("eth_chainId"), POLICY, price), // nothing is sponsored
      // The send itself isn't what the paymaster signs: its fees are fixed by then (and checked when it signed).
      authorizeBundlerRequest(db, asUser(ana), rpc("eth_sendUserOperation", [sponsored(ana.account, high), entryPoint07Address]), POLICY, price),
    ]);
    expect(answers.map((answer) => answer.ok)).toEqual([false, false, false, true, true]);
    expect(price).not.toHaveBeenCalled();
  });

  it("refuses with 502 when the price can't be read, instead of signing blind", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    await addLiveFund(db, { creatorId: ana.id, address: randomAccount(), members: [ana.id] });
    const broken = vi.fn(async (): Promise<bigint> => {
      throw new Error("Pimlico is down");
    });
    expect(await authorizeBundlerRequest(db, asUser(ana), sponsor(ana.account), POLICY, broken)).toMatchObject({ ok: false, status: 502 });
  });

  it("doesn't look at fees without a price to compare them to, as on the fork, which has no paymaster", async () => {
    const db = await testDb();
    const ana = await addUser(db, "Ana");
    await addLiveFund(db, { creatorId: ana.id, address: randomAccount(), members: [ana.id] });
    const heavy = { maxFeePerGas: hex(1000n * FAST), callGasLimit: hex(8_000_000n), verificationGasLimit: hex(2_000_000n) };
    expect(await authorizeBundlerRequest(db, asUser(ana), sponsor(ana.account, heavy), POLICY)).toMatchObject({ ok: true });
  });
});

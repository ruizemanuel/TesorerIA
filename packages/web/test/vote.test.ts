import type { Call } from "@tesoreria/wallet";
import { decodeFunctionData, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { OnItsWayError, UserFacingError } from "../src/lib/client/errors";
import { memberFundAbi } from "../src/lib/fund-abi";
import { castVote, executeCalls, voteCalls } from "../src/lib/vote";

const FUND = getAddress("0x00000000000000000000000000000000000f00d1");

const decode = (calls: Call[]) =>
  calls.map((c) => (expect(c.to).toBe(FUND), decodeFunctionData({ abi: memberFundAbi, data: c.data! })));

describe("voteCalls", () => {
  it("votes, and executes in the same operation when this vote completes the count", () => {
    expect(decode(voteCalls({ fund: FUND, proposalId: 3n, completes: false }))).toEqual([{ functionName: "vote", args: [3n] }]);
    expect(decode(voteCalls({ fund: FUND, proposalId: 3n, completes: true }))).toEqual([
      { functionName: "vote", args: [3n] },
      { functionName: "execute", args: [3n] },
    ]);
  });
});

describe("executeCalls", () => {
  it("executes a proposal that has its votes, alone", () => {
    expect(decode(executeCalls({ fund: FUND, proposalId: 3n }))).toEqual([{ functionName: "execute", args: [3n] }]);
  });
});

describe("castVote", () => {
  const names = (calls: Call[]) => decode(calls).map((c) => c.functionName);
  /** A `send` that fails with each of `failures` in turn, then goes through; it keeps the calls it was given. */
  function sender(...failures: unknown[]) {
    const sent: Call[][] = [];
    const send = async (calls: Call[]) => {
      sent.push(calls);
      if (failures.length > 0) throw failures.shift();
      return undefined;
    };
    return { send, sent };
  }
  const completing = { fund: FUND, proposalId: 3n, completes: true };

  it("sends the vote with its execution once, when it goes through", async () => {
    const { send, sent } = sender();
    await castVote(send, completing);
    expect(sent.map(names)).toEqual([["vote", "execute"]]);
  });

  it("votes alone when the vote with its execution fails, because the execution may be what reverts", async () => {
    const simulationRevert = new Error("UserOperation reverted during simulation with reason: ERC20: transfer amount exceeds balance");
    const { send, sent } = sender(simulationRevert);
    await castVote(send, completing);
    expect(sent.map(names)).toEqual([["vote", "execute"], ["vote"]]);
  });

  it("votes alone when the operation was included but reverted", async () => {
    const { send, sent } = sender(new UserFacingError("La operación no se pudo completar. No se movió plata."));
    await castVote(send, completing);
    expect(sent.map(names)).toEqual([["vote", "execute"], ["vote"]]);
  });

  it("does not ask again when the person cancelled the confirmation", async () => {
    const cancelled = new DOMException("The operation either timed out or was not allowed.", "NotAllowedError");
    const { send, sent } = sender(cancelled);
    await expect(castVote(send, completing)).rejects.toBe(cancelled);
    expect(sent).toHaveLength(1);
  });

  it("does not send again when the operation went out and may still land", async () => {
    const onItsWay = new OnItsWayError();
    const { send, sent } = sender(onItsWay);
    await expect(castVote(send, completing)).rejects.toBe(onItsWay);
    expect(sent).toHaveLength(1);
  });

  it("shows why the vote alone failed too, not the first failure", async () => {
    const second = new UserFacingError("Tu passkey no coincide con tu cuenta. Entrá de nuevo.");
    const { send, sent } = sender(new Error("simulation"), second);
    await expect(castVote(send, completing)).rejects.toBe(second);
    expect(sent.map(names)).toEqual([["vote", "execute"], ["vote"]]);
  });

  it("sends a vote that does not complete the count once, and fails with what failed", async () => {
    const failure = new Error("Failed to fetch");
    const { send, sent } = sender(failure);
    await expect(castVote(send, { ...completing, completes: false })).rejects.toBe(failure);
    expect(sent.map(names)).toEqual([["vote"]]);
  });
});

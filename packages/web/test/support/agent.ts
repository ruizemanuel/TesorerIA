import type { AgentSigner, AgentTransaction, ChainView, FundEvent, FundSnapshot } from "@tesoreria/agent";
import { type Hash, pad } from "viem";
import type { MakeContext } from "../../src/lib/agent-runner";
import { AGENT } from "./fixtures";

export const SENT_HASH: Hash = pad("0x7a", { size: 32 });

/**
 * An agent context over a fixed fund, keeping what it would send. `snapshot()` is read on each call, so a test
 * can change the fund between runs; `receipt` is how every sent transaction ends, and `receiptError` makes every
 * receipt wait fail instead; `sendError()`, when it returns one, makes the send throw after the node took it (it's
 * kept in `sent`); `send: false` is a dry run, as with the kill switch off.
 */
export function fakeAgent({
  snapshot,
  events = () => [],
  receipt = "success",
  receiptError,
  sendError = () => undefined,
  send = true,
}: {
  snapshot: () => FundSnapshot;
  events?: () => FundEvent[];
  receipt?: "success" | "reverted";
  receiptError?: Error;
  sendError?: () => Error | undefined;
  send?: boolean;
}) {
  const sent: AgentTransaction[] = [];
  const chain: ChainView = {
    gasBalance: async () => 1_000_000n,
    funds: async () => [snapshot().address],
    fund: async () => snapshot(),
    events: async () => events(),
    references: async () => {
      throw new Error("no prices in this test");
    },
    quote: async () => {
      throw new Error("no prices in this test");
    },
    receipt: async () => {
      if (receiptError) throw receiptError;
      return receipt;
    },
  };
  const signer: AgentSigner = {
    address: AGENT,
    estimate: async () => ({ gas: 200_000n, maxFeePerGas: 1n, maxCost: 200_000n }),
    send: async (tx) => {
      sent.push(tx);
      const error = sendError();
      if (error) throw error;
      return SENT_HASH;
    },
  };
  const makeContext: MakeContext = async (onSent) => ({ chain, signer, now: () => 1_791_644_400n, send, onSent });
  return { makeContext, sent };
}

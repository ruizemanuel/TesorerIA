import { ATTRIBUTION_SUFFIX } from "@tesoreria/wallet";
import { type Hex, custom } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { type TransactionSerializableCIP64, parseTransaction } from "viem/celo";
import { describe, expect, it } from "vitest";
import { USDT_FEE_ADAPTER } from "../src/chain";
import { createAgentSigner } from "../src/signer";

const LATEST_BLOCK = {
  number: "0x1",
  hash: `0x${"22".repeat(32)}`,
  parentHash: `0x${"33".repeat(32)}`,
  timestamp: "0x1",
  baseFeePerGas: "0x3b9aca00",
  gasLimit: "0x1c9c380",
  gasUsed: "0x0",
  transactions: [],
};

/** Parses a raw transaction the fake node received, checking that it is a CIP-64 one. */
function parseCip64(raw: Hex | undefined): TransactionSerializableCIP64 {
  if (raw === undefined) throw new Error("nothing was sent");
  const tx = parseTransaction(raw);
  expect(tx.type).toBe("cip64");
  return tx as TransactionSerializableCIP64;
}

/** A Celo node that answers what viem asks before sending, and keeps every raw transaction it gets. */
function fakeCelo() {
  const sent: Hex[] = [];
  const calls: { method: string; params: unknown[] }[] = [];
  const transport = custom({
    async request({ method, params }: { method: string; params: unknown[] }) {
      calls.push({ method, params });
      switch (method) {
        case "eth_chainId":
          return "0xa4ec";
        case "eth_getTransactionCount":
          return "0x0";
        case "eth_estimateGas":
          return "0x5208";
        case "eth_gasPrice":
        case "eth_maxPriorityFeePerGas":
          return "0x3b9aca00";
        case "eth_getBlockByNumber":
          return LATEST_BLOCK;
        case "eth_sendRawTransaction":
          sent.push(params[0] as Hex);
          return `0x${"11".repeat(32)}`;
        default:
          throw new Error(`unexpected RPC method ${method}`);
      }
    },
  });
  return { transport, sent, calls };
}

describe("createAgentSigner", () => {
  it("sends a CIP-64 transaction that pays gas in USDT and ends with the attribution suffix", async () => {
    const { transport, sent } = fakeCelo();
    const agent = createAgentSigner({ privateKey: generatePrivateKey(), transport });
    await agent.send({ to: "0x000000000000000000000000000000000000dEaD", data: "0x1234" });
    expect(sent).toHaveLength(1);
    const tx = parseCip64(sent[0]);
    expect(tx.feeCurrency?.toLowerCase()).toBe(USDT_FEE_ADAPTER.toLowerCase());
    expect(tx.data).toBe(`0x1234${ATTRIBUTION_SUFFIX.slice(2)}`);
  });

  it("tags a contract creation too", async () => {
    const { transport, sent } = fakeCelo();
    const agent = createAgentSigner({ privateKey: generatePrivateKey(), transport });
    await agent.send({ data: "0x6080" });
    const tx = parseCip64(sent[0]);
    expect(tx.to ?? null).toBeNull();
    expect(tx.feeCurrency?.toLowerCase()).toBe(USDT_FEE_ADAPTER.toLowerCase());
    expect(tx.data).toBe(`0x6080${ATTRIBUTION_SUFFIX.slice(2)}`);
  });

  it("estimates in USDT with the tagged data, without sending", async () => {
    const { transport, sent, calls } = fakeCelo();
    const agent = createAgentSigner({ privateKey: generatePrivateKey(), transport });
    const estimate = await agent.estimate({ data: "0x6080" });
    expect(sent).toHaveLength(0);
    // The fake node: 21,000 gas, and a gas price equal to the priority fee (1 gwei), so no base fee to multiply.
    expect(estimate).toEqual({ gas: 21_000n, maxFeePerGas: 1_000_000_000n, maxCost: 21_000n * 1_000_000_000n });
    const estimateGas = calls.find((c) => c.method === "eth_estimateGas");
    expect(estimateGas?.params[0]).toMatchObject({
      data: `0x6080${ATTRIBUTION_SUFFIX.slice(2)}`,
      feeCurrency: USDT_FEE_ADAPTER,
    });
    expect(calls.find((c) => c.method === "eth_gasPrice")?.params).toEqual([USDT_FEE_ADAPTER]);
  });
});

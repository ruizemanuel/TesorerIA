import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import { FACTORIES, FUND_FACTORY_BLOCK, FUND_FACTORY_V2, FUND_FACTORY_V2_BLOCK } from "../src/chain";
import type { LogReader } from "../src/events";
import type { ContractReader } from "../src/market";
import { type CeloClient, createChainView } from "../src/view";

const AGENT = getAddress("0x00000000000000000000000000000000000a6e17");
const FUND = getAddress("0x00000000000000000000000000000000000f00d1");
const TO_BLOCK = 90_000_000n;

function view(options: { factories?: (typeof FACTORIES)[number][]; fromBlock?: bigint } = {}) {
  const logs = vi.fn<LogReader>(async () => []);
  const chain = createChainView({ celo: {} as CeloClient, base: {} as ContractReader, logs, agent: AGENT, ...options });
  return { chain, logs };
}

describe("createChainView", () => {
  it("reads a fund's history from the block of the oldest factory, whichever fund it is", async () => {
    const { chain, logs } = view();
    await chain.events(FUND, TO_BLOCK);
    expect(logs).toHaveBeenCalledWith({ address: FUND, fromBlock: FUND_FACTORY_BLOCK, toBlock: TO_BLOCK });
  });

  it("finds the oldest factory whatever the order it was given them in", async () => {
    const { chain, logs } = view({ factories: [...FACTORIES].reverse() });
    await chain.events(FUND, TO_BLOCK);
    expect(logs).toHaveBeenCalledWith({ address: FUND, fromBlock: FUND_FACTORY_BLOCK, toBlock: TO_BLOCK });
  });

  it("starts at the block of the only factory it serves", async () => {
    const { chain, logs } = view({ factories: [{ address: FUND_FACTORY_V2, block: FUND_FACTORY_V2_BLOCK, version: 2 }] });
    await chain.events(FUND, TO_BLOCK);
    expect(logs).toHaveBeenCalledWith({ address: FUND, fromBlock: FUND_FACTORY_V2_BLOCK, toBlock: TO_BLOCK });
  });

  it("starts at the block it is told, when it is told one", async () => {
    const { chain, logs } = view({ fromBlock: 83_200_000n });
    await chain.events(FUND, TO_BLOCK);
    expect(logs).toHaveBeenCalledWith({ address: FUND, fromBlock: 83_200_000n, toBlock: TO_BLOCK });
  });

  it("refuses to serve no factory", () => {
    expect(() => view({ factories: [] })).toThrow("A chain view needs at least one factory");
  });
});

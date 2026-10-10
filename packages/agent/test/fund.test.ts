import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import { type CeloReader, readFund } from "../src/fund";

const FUND = getAddress("0x00000000000000000000000000000000000f00d5");
const MEMBER = getAddress("0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F");

describe("readFund", () => {
  it("reads every value at the chain's latest block, never at a block number viem kept from an earlier call", async () => {
    const getBlockNumber = vi.fn(async (_?: { cacheTime?: number }) => 100n);
    const multicall = vi.fn(async ({ contracts }: { contracts: unknown[] }) =>
      contracts.length === 10 ? [MEMBER, false, [MEMBER], 2, 1n, 0n, 0n, 0n, 0n, 0n] : [0n],
    );
    const readContract = vi.fn(async () => 0n);
    const client = { getBlockNumber, multicall, readContract } as unknown as CeloReader;

    const snapshot = await readFund(client, FUND);

    // A receipt that came back before the block number was polled again would leave the cached one behind it.
    expect(getBlockNumber).toHaveBeenCalledWith({ cacheTime: 0 });
    expect(snapshot.block).toBe(100n);
    for (const [call] of multicall.mock.calls) expect(call).toMatchObject({ blockNumber: 100n });
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 100n }));
  });
});

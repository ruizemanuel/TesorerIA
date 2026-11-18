import { existsSync, readFileSync } from "node:fs";
import type { Abi, AbiParameter } from "viem";
import { describe, expect, it } from "vitest";
import { fundAbi, fundErrorAbi, fundEventAbi, fundFactoryAbi, fundFactoryV2Abi, fundV2Abi } from "../src/abi";

/** What `forge build` writes in contracts/out; absent in a fresh clone until it runs. */
function compiled(name: string): Abi | null {
  const file = new URL(`../../../contracts/out/${name}.sol/${name}.json`, import.meta.url);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { abi: Abi }).abi : null;
}

/** Types, indexed flags, outputs and mutability: everything that changes encoding or decoding. */
function shape(params: readonly AbiParameter[]): string {
  return params
    .map((p) => {
      const components = "components" in p && p.components ? `(${shape(p.components)})` : "";
      const indexed = "indexed" in p && p.indexed ? " indexed" : "";
      return `${p.type}${components}${indexed}`;
    })
    .join(",");
}

function signatures(abi: Abi): string[] {
  return abi.flatMap((item) => {
    if (item.type === "function") {
      return [`function ${item.name}(${shape(item.inputs)}) ${item.stateMutability} returns (${shape(item.outputs)})`];
    }
    if (item.type === "event") return [`event ${item.name}(${shape(item.inputs)})`];
    return [];
  });
}

describe.each([
  ["Fund", fundAbi],
  ["FundFactory", fundFactoryAbi],
  ["FundV2", fundV2Abi],
  ["FundFactoryV2", fundFactoryV2Abi],
] as const)("the agent's %s ABI", (name, ours) => {
  const source = compiled(name);
  it.skipIf(source === null)("matches what the contract compiles to (run forge build in contracts/ first)", () => {
    const all = signatures(source as Abi);
    for (const signature of signatures(ours)) expect(all).toContain(signature);
  });
});

describe("the agent's event ABI", () => {
  const fund = compiled("Fund");
  const fundV2 = compiled("FundV2");
  const events = (abi: Abi) => signatures(abi).filter((signature) => signature.startsWith("event "));
  it.skipIf(fund === null || fundV2 === null)("has every event of either version (run forge build in contracts/ first)", () => {
    const ours = events(fundEventAbi);
    // The same signature twice would be one event twice; the two Conversions differ in their types, so both stay.
    expect(new Set(ours).size).toBe(ours.length);
    const theirs = [...events(fund as Abi), ...events(fundV2 as Abi)];
    for (const signature of ours) expect(theirs).toContain(signature);
    for (const signature of theirs) expect(ours).toContain(signature);
  });
});

describe("the agent's ABI of the funds' errors", () => {
  const names = (abi: Abi) => abi.flatMap((item) => (item.type === "error" ? [`${item.name}(${shape(item.inputs)})`] : []));
  const ours = names(fundErrorAbi);
  // OpenZeppelin's ReentrancyGuard and SafeERC20, and Uniswap's TickMath: not the funds' own.
  const libraries = ["ReentrancyGuardReentrantCall()", "SafeERC20FailedOperation(address)", "T()"];

  it("lists Fund's 20 errors first, then FundV2's 5 new ones", () => {
    expect(ours).toHaveLength(25);
    expect(ours.slice(20)).toEqual(["NoDollar()", "InsufficientPending()", "GiveBackTooLarge()", "TooManyProposals()", "NoteTooLong()"]);
  });

  const fund = compiled("Fund");
  it.skipIf(fund === null)("has every error Fund declares, and the compiled ABI adds only its libraries' (run forge build in contracts/ first)", () => {
    const theirs = names(fund as Abi);
    for (const error of ours.slice(0, 20)) expect(theirs).toContain(error);
    expect(theirs.filter((error) => !ours.slice(0, 20).includes(error)).sort()).toEqual(libraries);
  });

  const fundV2 = compiled("FundV2");
  it.skipIf(fundV2 === null)("has every error FundV2 declares, and the compiled ABI adds only its libraries' (run forge build in contracts/ first)", () => {
    const theirs = names(fundV2 as Abi);
    for (const error of ours) expect(theirs).toContain(error);
    expect(theirs.filter((error) => !ours.includes(error)).sort()).toEqual(libraries);
  });
});

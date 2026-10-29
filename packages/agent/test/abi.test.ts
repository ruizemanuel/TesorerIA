import { existsSync, readFileSync } from "node:fs";
import type { Abi, AbiParameter } from "viem";
import { describe, expect, it } from "vitest";
import { fundAbi, fundErrorAbi, fundFactoryAbi } from "../src/abi";

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
] as const)("the agent's %s ABI", (name, ours) => {
  const source = compiled(name);
  it.skipIf(source === null)("matches what the contract compiles to (run forge build in contracts/ first)", () => {
    const all = signatures(source as Abi);
    for (const signature of signatures(ours)) expect(all).toContain(signature);
  });
});

describe("the agent's ABI of Fund's errors", () => {
  const source = compiled("Fund");
  it.skipIf(source === null)("has every error Fund declares, and the compiled ABI adds only its libraries' (run forge build in contracts/ first)", () => {
    const names = (abi: Abi) => abi.flatMap((item) => (item.type === "error" ? [`${item.name}(${shape(item.inputs)})`] : []));
    const ours = names(fundErrorAbi);
    expect(ours).toHaveLength(20);
    const theirs = names(source as Abi);
    for (const error of ours) expect(theirs).toContain(error);
    // OpenZeppelin's ReentrancyGuard and SafeERC20, and Uniswap's TickMath: not Fund's own.
    expect(theirs.filter((error) => !ours.includes(error)).sort()).toEqual(["ReentrancyGuardReentrantCall()", "SafeERC20FailedOperation(address)", "T()"]);
  });
});

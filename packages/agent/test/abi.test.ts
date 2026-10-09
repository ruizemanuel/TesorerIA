import { existsSync, readFileSync } from "node:fs";
import type { Abi, AbiParameter } from "viem";
import { describe, expect, it } from "vitest";
import { fundAbi, fundFactoryAbi } from "../src/abi";

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

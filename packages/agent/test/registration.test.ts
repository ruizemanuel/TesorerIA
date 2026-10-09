import { readFileSync } from "node:fs";
import { type Hex, type Log, decodeFunctionData, encodeAbiParameters, encodeEventTopics, pad } from "viem";
import { describe, expect, it } from "vitest";
import { AGENT_ADDRESS, FUND_FACTORY, IDENTITY_REGISTRY } from "../src/chain";
import {
  AGENT_URI,
  agentIdFromLogs,
  agentRegistration,
  identityRegistryAbi,
  registerData,
  registrationFile,
} from "../src/registration";

const REGISTRATION_JSON = new URL("../registration.json", import.meta.url);

function registeredLog(address: Hex, agentId: bigint): Log {
  return {
    address,
    topics: encodeEventTopics({ abi: identityRegistryAbi, eventName: "Registered", args: { agentId, owner: AGENT_ADDRESS } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: "string" }], [AGENT_URI]),
    blockHash: pad("0x01", { size: 32 }),
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: pad("0x02", { size: 32 }),
    transactionIndex: 0,
    removed: false,
  };
}

describe("the ERC-8004 registration", () => {
  it("is exactly what's committed in registration.json (run pnpm registration:write after a change)", () => {
    expect(readFileSync(REGISTRATION_JSON, "utf8")).toBe(registrationFile());
  });

  it("follows registration-v1 and names the agent's wallet, the factory and the limits", () => {
    const file = agentRegistration();
    expect(file.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(file.description).toContain(AGENT_ADDRESS);
    expect(file.description).toContain(FUND_FACTORY);
    expect(file.description).toContain("100,000 wARS per reimbursement");
    expect(file.description).toContain("500 USDT per conversion");
    expect(file.active).toBe(true);
  });

  it("registers AGENT_URI, served from this repo on GitHub", () => {
    expect(AGENT_URI).toBe("https://raw.githubusercontent.com/ruizemanuel/TesorerIA/main/packages/agent/registration.json");
    expect(decodeFunctionData({ abi: identityRegistryAbi, data: registerData() })).toEqual({
      functionName: "register",
      args: [AGENT_URI],
    });
  });

  it("reads the agent id from the Identity Registry's Registered event, and from nowhere else", () => {
    const impostor = "0x000000000000000000000000000000000000bEEF";
    expect(agentIdFromLogs([registeredLog(impostor, 1n), registeredLog(IDENTITY_REGISTRY, 9_887n)])).toBe(9_887n);
    expect(() => agentIdFromLogs([registeredLog(impostor, 1n)])).toThrow("no Registered event");
  });
});

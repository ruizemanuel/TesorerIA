import { readFileSync } from "node:fs";
import { type Hex, type Log, decodeFunctionData, encodeAbiParameters, encodeEventTopics, pad } from "viem";
import { describe, expect, it } from "vitest";
import { AGENT_ADDRESS, FUND_FACTORY, IDENTITY_REGISTRY } from "../src/chain";
import {
  AGENT_IMAGE,
  AGENT_URI,
  agentIdFromLogs,
  agentRegistration,
  identityRegistryAbi,
  registerData,
  registrationFile,
  setAgentUriData,
  uriUpdateFromLogs,
} from "../src/registration";

const REGISTRATION_JSON = new URL("../registration.json", import.meta.url);
const IMAGE_PNG = new URL("../image.png", import.meta.url);

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

function uriUpdatedLog(address: Hex, agentId: bigint, newURI: string): Log {
  return {
    ...registeredLog(address, agentId),
    topics: encodeEventTopics({ abi: identityRegistryAbi, eventName: "URIUpdated", args: { agentId, updatedBy: AGENT_ADDRESS } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: "string" }], [newURI]),
  };
}

describe("the ERC-8004 registration", () => {
  it("is exactly what's committed in registration.json (run pnpm registration:write after a change)", () => {
    expect(readFileSync(REGISTRATION_JSON, "utf8")).toBe(registrationFile());
  });

  it("follows registration-v1, names the agent's wallet, the factory and the limits, and points to the live app", () => {
    const file = agentRegistration();
    expect(file.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(file.description).toContain(AGENT_ADDRESS);
    expect(file.description).toContain(FUND_FACTORY);
    expect(file.description).toContain("100,000 wARS per reimbursement");
    expect(file.description).toContain("500 USDT per conversion");
    expect(file.description).toContain("At the close of each week it writes the group a summary of who owes what and what happened");
    expect(file.services).toEqual([{ name: "web", endpoint: "https://tesoreria.finance" }]);
    expect(file.active).toBe(true);
  });

  it("shows the agent's avatar as its image, a square PNG served from this repo on GitHub next to the file", () => {
    expect(agentRegistration().image).toBe(AGENT_IMAGE);
    expect(AGENT_IMAGE).toBe("https://raw.githubusercontent.com/ruizemanuel/TesorerIA/main/packages/agent/image.png");
    const png = readFileSync(IMAGE_PNG);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // The IHDR chunk comes first: its width and height are at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512]);
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

  it("sets the agent's URI to AGENT_URI again, so indexers read the file again", () => {
    expect(decodeFunctionData({ abi: identityRegistryAbi, data: setAgentUriData(9_887n) })).toEqual({
      functionName: "setAgentURI",
      args: [9_887n, AGENT_URI],
    });
  });

  it("reads the URI update from the Identity Registry's URIUpdated event, and from nowhere else", () => {
    const impostor = "0x000000000000000000000000000000000000bEEF";
    expect(
      uriUpdateFromLogs([uriUpdatedLog(impostor, 1n, "https://example.com"), uriUpdatedLog(IDENTITY_REGISTRY, 9_887n, AGENT_URI)]),
    ).toEqual({ agentId: 9_887n, newURI: AGENT_URI, updatedBy: AGENT_ADDRESS });
    expect(() => uriUpdateFromLogs([uriUpdatedLog(impostor, 9_887n, AGENT_URI)])).toThrow("no URIUpdated event");
  });
});

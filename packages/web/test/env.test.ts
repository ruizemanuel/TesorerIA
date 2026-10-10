import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/lib/env";

const base = {
  RP_ID: "localhost",
  ORIGIN: "http://localhost:3000",
  SESSION_SECRET: "s".repeat(32),
  DATABASE_URL: "memory",
};

/** What parsing says went wrong, or "" if it parsed. */
function problem(source: Record<string, string | undefined>): string {
  try {
    parseEnv(source);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
}

describe("parseEnv", () => {
  it("fills in what has a default", () => {
    expect(parseEnv(base)).toMatchObject({
      CHAIN_MODE: "mainnet",
      CELO_RPC_URL: "https://forno.celo.org",
      BASE_RPC_URL: "https://mainnet.base.org",
      AGENT_SEND: "off",
    });
  });

  it("counts an empty value as missing, so a copied .env.example doesn't fail every route", () => {
    const blank = {
      ...base,
      CHAIN_MODE: "",
      CELO_RPC_URL: "",
      BASE_RPC_URL: "",
      PIMLICO_API_KEY: "",
      PIMLICO_SPONSORSHIP_POLICY_ID: "",
      AGENT_PRIVATE_KEY: "",
      AGENT_SEND: "",
      HEARTBEAT_SECRET: "",
      BLOCKSCOUT_API_KEY: "",
      PUBLIC_FUND: "",
    };
    expect(parseEnv(blank)).toMatchObject({ CHAIN_MODE: "mainnet", CELO_RPC_URL: "https://forno.celo.org", AGENT_SEND: "off" });
    expect(parseEnv(blank).AGENT_PRIVATE_KEY).toBeUndefined();
    expect(parseEnv(blank).PUBLIC_FUND).toBeUndefined();
    expect(problem({ ...base, SESSION_SECRET: "" })).toContain("SESSION_SECRET");
  });

  it("asks for the database on mainnet, and only there", () => {
    expect(problem({ ...base, DATABASE_URL: undefined })).toContain("DATABASE_URL");
    expect(problem({ ...base, DATABASE_URL: "" })).toContain("DATABASE_URL");
    expect(problem({ ...base, DATABASE_URL: undefined, CHAIN_MODE: "fork" })).toBe("");
  });

  it("refuses the fork on a Vercel deployment, where it would point the web at a node that isn't there", () => {
    const message = problem({ ...base, CHAIN_MODE: "fork", VERCEL: "1" });
    expect(message).toContain("CHAIN_MODE");
    expect(message).toContain("deployment");
    expect(problem({ ...base, CHAIN_MODE: "mainnet", VERCEL: "1" })).toBe("");
    expect(problem({ ...base, CHAIN_MODE: "fork", VERCEL: "" })).toBe("");
    expect(problem({ ...base, CHAIN_MODE: "fork" })).toBe("");
  });

  it("keeps the agent's kill switch off unless it is exactly 'on'", () => {
    expect(parseEnv({ ...base, AGENT_SEND: "on" }).AGENT_SEND).toBe("on");
    expect(parseEnv({ ...base, AGENT_SEND: "off" }).AGENT_SEND).toBe("off");
    expect(problem({ ...base, AGENT_SEND: "yes" })).toContain("AGENT_SEND");
  });

  it("names a bad variable, never its content", () => {
    const key = `0x${"z".repeat(64)}`;
    const secret = "too-short-secret-value";
    const message = problem({ ...base, AGENT_PRIVATE_KEY: key, SESSION_SECRET: secret });
    expect(message).toContain("AGENT_PRIVATE_KEY");
    expect(message).toContain("SESSION_SECRET");
    expect(message).not.toContain(key);
    expect(message).not.toContain(secret);
  });
});

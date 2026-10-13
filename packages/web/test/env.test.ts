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

  it("leaves the chat off without CHAT_MODEL, with its caps at 30 a member and 150 in all (spec, 8.2)", () => {
    const settings = parseEnv(base);
    expect(settings.CHAT_MODEL).toBeUndefined();
    expect(settings).toMatchObject({ CHAT_MEMBER_DAILY_LIMIT: 30, CHAT_DAILY_LIMIT: 150 });
    expect(parseEnv({ ...base, CHAT_MODEL: "", CHAT_MEMBER_DAILY_LIMIT: "", CHAT_DAILY_LIMIT: "" })).toMatchObject({
      CHAT_MODEL: undefined,
      CHAT_MEMBER_DAILY_LIMIT: 30,
      CHAT_DAILY_LIMIT: 150,
    });
  });

  it("reads the chat's model and caps, and refuses a cap that isn't a whole number above zero", () => {
    expect(
      parseEnv({ ...base, CHAT_MODEL: "anthropic/claude-sonnet-5.5", CHAT_MEMBER_DAILY_LIMIT: "5", CHAT_DAILY_LIMIT: "40" }),
    ).toMatchObject({ CHAT_MODEL: "anthropic/claude-sonnet-5.5", CHAT_MEMBER_DAILY_LIMIT: 5, CHAT_DAILY_LIMIT: 40 });
    expect(problem({ ...base, CHAT_MEMBER_DAILY_LIMIT: "0" })).toMatch(/CHAT_MEMBER_DAILY_LIMIT/);
    expect(problem({ ...base, CHAT_DAILY_LIMIT: "1.5" })).toMatch(/CHAT_DAILY_LIMIT/);
  });

  it("takes the scripted model only on the fork: it must never answer on mainnet", () => {
    expect(problem({ ...base, CHAT_MODEL: "mock" })).toMatch(/CHAT_MODEL/);
    expect(parseEnv({ ...base, CHAIN_MODE: "fork", CHAT_MODEL: "mock" }).CHAT_MODEL).toBe("mock");
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";
import { llmsTxt } from "../src/lib/llms-txt";

const PUBLIC_FUND = "0x9A74F670F3c59Ae4B8450fdD477b0461b89D2dfD";

/** Fund's 20 errors and their selectors, from `cast sig` (Foundry), not from viem. */
const ERRORS = [
  ["InvalidParams()", "0xa86b6512"],
  ["NotMember()", "0x291fc442"],
  ["OnlyAgent()", "0x73620441"],
  ["OnlyMemberOrAgent()", "0x6f94c5f4"],
  ["FundIsClosed()", "0xcf3503dc"],
  ["ZeroAmount()", "0x1f2a2005"],
  ["BalanceCapExceeded()", "0x2c5ff865"],
  ["WeeklyCapExceeded()", "0xc80ff02b"],
  ["InsufficientBalance()", "0xf4d678b8"],
  ["RecipientNotMember()", "0x919941a4"],
  ["MinOutTooLow()", "0x7218c912"],
  ["InsufficientOutput()", "0xbb2875c3"],
  ["OnlyPool()", "0x4b602735"],
  ["ProposalNotFound()", "0x635e8737"],
  ["ProposalExpired()", "0x28a72379"],
  ["ProposalAlreadyExecuted()", "0x51618d53"],
  ["AlreadyVoted()", "0x7c9a1cf9"],
  ["NotEnoughVotes()", "0x0b7b8dc6"],
  ["SwapOverpayment()", "0xdf0f68a0"],
  ["FundNotClosed()", "0x593cbbf1"],
] as const;

let GET: () => Response;

beforeAll(async () => {
  vi.stubEnv("RP_ID", "tesoreria.finance");
  vi.stubEnv("ORIGIN", "https://tesoreria.finance");
  vi.stubEnv("SESSION_SECRET", "a-session-secret-for-tests-only-0123456789");
  vi.stubEnv("DATABASE_URL", "memory");
  vi.stubEnv("PUBLIC_FUND", PUBLIC_FUND.toLowerCase());
  ({ GET } = await import("../src/app/llms.txt/route"));
});

describe("/llms.txt: the site for an agent that reads it (llmstxt.org)", () => {
  it("answers plain text, in llmstxt.org's shape: the name, then a one-paragraph summary", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const text = await response.text();
    expect(text).toMatch(/^# TesorerIA\n\n> \S[^\n]+\n\n/);
    expect(text).toMatch(/\n## /);
  });

  it("names the network, the contracts, the tokens, the pool and the agent, by their addresses on Celo", async () => {
    const text = await GET().text();
    expect(text).toContain("chain id 42220");
    for (const address of [
      "0xdF3B0d9edCA58Aac7c9Db4F2931f3559daf82020", // FundFactory
      "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D", // wARS
      "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", // USDT
      "0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391", // the wARS/USDT pool
      "0x6BE3c1eB63A4edbc6C23c281F93F81B14eF3a671", // the agent's wallet
      "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", // the ERC-8004 identity registry
    ]) {
      expect(text).toContain(`https://celo.blockscout.com/address/${address}`);
    }
    expect(text).toContain("fee tier 100 (0.01 %)");
    expect(text).toContain("agent 9887");
    expect(text).toContain("https://8004scan.io/agents/celo/9887");
    expect(text).toContain("https://raw.githubusercontent.com/ruizemanuel/TesorerIA/main/packages/agent/registration.json");
  });

  it("points to the real group's fund, checksummed, and to its public page on this site", async () => {
    const text = await GET().text();
    expect(text).toContain(`https://celo.blockscout.com/address/${PUBLIC_FUND}`);
    expect(text).toContain(`https://tesoreria.finance/f/${PUBLIC_FUND}/publico`);
  });

  it("lists every error of Fund with its selector, on one line each", async () => {
    const lines = (await GET().text()).split("\n");
    for (const [error, selector] of ERRORS) {
      expect(lines.filter((line) => line.includes(`\`${error}\``) && line.includes(selector)), error).toHaveLength(1);
    }
  });

  it("says where a week starts and what the weekly cap counts, as the contract does", async () => {
    const text = await GET().text();
    expect(text).toContain("`currentWeek() = (block.timestamp - startTime) / 7 days`");
    expect(text).toContain("`spentInWeek[currentWeek()]`");
  });

  it("says the agent's own limits, on top of the contract's", async () => {
    const text = await GET().text();
    expect(text).toContain("100,000 wARS per reimbursement");
    expect(text).toContain("150,000 wARS a day");
    expect(text).toContain("500 USDT per conversion");
    expect(text).toContain("1,000 USDT a day");
    expect(text).toContain("20 transactions a day");
    expect(text).toContain("the last 86,400 blocks");
  });

  it("leaves the public fund out when the site has none", () => {
    const text = llmsTxt("https://tesoreria.finance", null);
    expect(text).not.toContain("/publico");
    expect(text).toContain("0xdF3B0d9edCA58Aac7c9Db4F2931f3559daf82020");
  });
});

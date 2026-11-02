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

  it("says the agent's own limits live in its code, so the chain can't check them", async () => {
    const text = await GET().text();
    expect(text).toContain("They live in the agent's code, not in the contract");
  });

  it("points to every fund the factory deployed, not only the real group's", async () => {
    const text = await GET().text();
    expect(text).toContain("`funds(i)` for each `i` below `fundCount()`");
  });

  it("says where wARS and USDT come from, and where what the agent pays back goes", async () => {
    const text = await GET().text();
    expect(text).toContain("withdraw wARS on the Celo network");
    expect(text).toContain("USDT on Celo from any exchange");
    expect(text).toContain("sell them 1:1 for pesos");
  });

  it("says this site counts a fund's weeks from 1, where the contract counts from 0", async () => {
    const text = await GET().text();
    expect(text).toContain("its week N is the contract's week N − 1");
  });

  it("says a USDT contribution is credited at the pool's TWAP, and the fund absorbs what the conversion gets below it", async () => {
    const text = await GET().text();
    expect(text).toContain("30-minute TWAP");
    expect(text).toContain("`creditedWars` in `Contribution`");
    expect(text).toContain("`warsOut` in `Conversion`");
    expect(text).toContain("more than 2 % below");
  });

  it("lists the functions the site and its agent call, with their parameters, who may call them and propose's actions", async () => {
    const text = await GET().text();
    const lines = text.split("\n");
    for (const signature of [
      "contributeWars(uint256 amount)",
      "contributeUsdt(uint256 amount)",
      "convert(uint256 usdtAmount, uint256 minWarsOut)",
      "reimburseAgreedExpense(address member, uint256 amount, bytes32 ref)",
      "propose(uint8 action, address a, address b, uint256 amount, string note)",
      "vote(uint256 id)",
      "execute(uint256 id)",
      "weeklyCap()",
      "spentInWeek(uint256)",
      "getProposal(uint256 id)",
    ]) {
      expect(lines.filter((line) => line === `- \`${signature}\``), signature).toHaveLength(1);
    }
    expect(text).toContain("anyone can call `execute` once a proposal has the votes it needs");
    expect(text).toContain("an ERC-20 `approve`");
    expect(text).toContain("0 Pay, 1 AddMember, 2 RemoveMember, 3 ReplaceMember, 4 SetWeeklyCap, 5 SetVotesRequired, 6 SetAgent, 7 Close");
  });

  it("gives this site's addresses for a fund's public page, its movements, a week's summary and a receipt, and how it picks a language", async () => {
    const text = await GET().text();
    for (const path of [
      "/f/<fund>/publico`",
      "/f/<fund>/publico/movimientos`",
      "/f/<fund>/publico?p=resumen&semana=<N>`",
      "/f/<fund>/publico?p=comprobante&id=<transaction hash>:<log index>`",
    ]) {
      expect(text).toContain(`\`https://tesoreria.finance${path}`);
    }
    expect(text).toContain("the `lang` cookie (`es` or `en`)");
    expect(text).toContain("Accept-Language");
  });

  it("leaves the public fund out when the site has none", () => {
    const text = llmsTxt("https://tesoreria.finance", null);
    // The site's URL patterns name `<fund>`, never a fund's address.
    expect(text).not.toMatch(/\/f\/0x[0-9a-fA-F]{40}\/publico/);
    expect(text).not.toContain("A real group's fund");
    expect(text).toContain("0xdF3B0d9edCA58Aac7c9Db4F2931f3559daf82020");
  });
});

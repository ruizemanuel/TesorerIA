import { beforeAll, describe, expect, it, vi } from "vitest";
import { llmsTxt } from "../src/lib/llms-txt";

const PUBLIC_FUND = "0x9A74F670F3c59Ae4B8450fdD477b0461b89D2dfD";

const FACTORY_V2 = "0x1337a61CF7fDeF412E04894FE705d4341878d4d3";
const FEE_RECIPIENT = "0x5Dc9C76C6999C6C604b3D91C040D17b125ca4581";

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

/** The five errors FundV2 adds, from `cast sig` too. */
const ERRORS_V2 = [
  ["NoDollar()", "0xad2b14af"],
  ["InsufficientPending()", "0xeed47552"],
  ["GiveBackTooLarge()", "0x23a618cb"],
  ["TooManyProposals()", "0x188f201e"],
  ["NoteTooLong()", "0x155be563"],
] as const;

/** A section of the page: from its heading to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const level = heading.match(/^#+/)![0].length;
  const start = text.indexOf(`\n${heading}\n`);
  expect(start, heading).toBeGreaterThan(-1);
  const rest = text.slice(start + 1);
  const next = rest.slice(heading.length).search(new RegExp(`\n#{1,${level}} `));
  return next === -1 ? rest : rest.slice(0, heading.length + next);
}

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
    // Ripio is where most get them, not the only way: wARS is a token like any other on Celo.
    expect(text).toContain("or from any Celo wallet that holds wARS");
    expect(text).toContain("USDT on Celo from any exchange");
    expect(text).toContain("sell them 1:1 for pesos");
  });

  it("says this site counts a fund's weeks from 1, where the contract counts from 0", async () => {
    const text = await GET().text();
    expect(text).toContain("its week N is the contract's week N − 1");
  });

  it("says a USDT contribution is credited at the pool's TWAP, and counts toward dues at what its conversion got", async () => {
    const text = await GET().text();
    expect(text).toContain("30-minute TWAP");
    expect(text).toContain("`creditedWars` in `Contribution`");
    expect(text).toContain("`warsOut` in `Conversion`");
    expect(text).toContain("more than 2 % below");
    expect(text).toContain("what its conversion got");
    expect(text).toContain("covers the difference");
    expect(text).not.toContain("the fund absorbs");
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
    expect(text).toContain("0 Pay, 1 AddMember, 2 RemoveMember, 3 ReplaceMember, 4 SetWeeklyCap, 5 SetVotesRequired, 6 SetAgent, 7 Close.");
    // Fund.Action ends at Close: the 8 is FundV2's, in its own section.
    expect(section(text, "## Functions")).not.toContain("8 GiveBack");
  });

  it("names both factories, by their addresses and the version of the funds each one deploys", async () => {
    const text = await GET().text();
    const contracts = section(text, "## Contracts");
    expect(contracts).toContain("[FundFactory](https://celo.blockscout.com/address/0xdF3B0d9edCA58Aac7c9Db4F2931f3559daf82020)");
    expect(contracts).toContain(`[FundFactoryV2](https://celo.blockscout.com/address/${FACTORY_V2})`);
    expect(contracts).toContain("version 1");
    expect(contracts).toContain("version 2");
    expect(contracts).toContain("`funds(i)` for each `i` below `fundCount()`, on either factory");
  });

  it("lists every error of either version with its selector, on one line each: 25 in all", async () => {
    const text = await GET().text();
    const lines = text.split("\n");
    const all = [...ERRORS, ...ERRORS_V2];
    expect(all).toHaveLength(25);
    for (const [error, selector] of all) {
      expect(lines.filter((line) => line.includes(`\`${error}\``) && line.includes(selector)), error).toHaveLength(1);
    }
    // And no other: the section holds exactly those 25.
    expect(section(text, "## Errors").split("\n").filter((line) => line.startsWith("- `"))).toHaveLength(25);
  });

  it("says what the agent can do with a fund's money: pay members, and in a FundFactoryV2 fund send its own fee to TesorerIA", async () => {
    const text = await GET().text();
    expect(text).toContain(
      "The agent can only pay members, never above the weekly cap, and, in a FundFactoryV2 fund, send the fee that fund sets aside (each one sets its own; the web creates them at 0.25 %) to TesorerIA's account, which anyone can do; and it can't change the rules.",
    );
  });

  it("says new funds keep 0.25 % for gas, and who sends it where", async () => {
    const v2 = section(await GET().text(), "## Version 2");
    expect(v2).toContain("New funds keep 0.25 % for gas");
    expect(v2).toContain("`feeOwed`");
    expect(v2).toContain("anyone can call `payFee`");
    expect(v2).toContain(`[fee recipient](https://celo.blockscout.com/address/${FEE_RECIPIENT})`);
    // The contract's own ceiling, so a reader doesn't take the web's 0.25 % for the only one possible.
    expect(v2).toContain("up to 1 %");
  });

  it("says v2 holds USDT pending until it converts it, and credits what the conversion really got", async () => {
    const v2 = section(await GET().text(), "## Version 2");
    expect(v2).toContain("A USDT contribution is not credited when it arrives: it stays pending");
    expect(v2).toContain("`pendingDollar(address)`");
    expect(v2).toContain("until the agent converts it");
    expect(v2).toContain("at what the conversion really got");
    expect(v2).toContain("`credited` in `Conversion`");
    // Version 1's rule (credited at once, at the TWAP) is not told for version 2.
    expect(v2).not.toContain("credited to the member at once");
  });

  it("lists v2's own functions and reads, and propose's actions with 8 GiveBack", async () => {
    const v2 = section(await GET().text(), "## Version 2");
    const lines = v2.split("\n");
    for (const signature of [
      "contribute(uint256 amount)",
      "contributeDollar(uint256 amount)",
      "convert(address[] members_, uint256[] dollarAmounts, uint256 minCurrencyOut)",
      "payFee()",
      "currency()",
      "dollar()",
      "pool()",
      "feeBps()",
      "feeOwed()",
      "availableCurrency()",
      "quoteDollar(uint256 dollarAmount)",
      "pendingDollar(address)",
      "totalPendingDollar()",
      "proposalsInWeek(uint256 week, address)",
    ]) {
      expect(lines.filter((line) => line === `- \`${signature}\``), signature).toHaveLength(1);
    }
    // What is the same as version 1's is said once, in version 1's lists: this one holds what version 2 adds or changes.
    expect(lines).not.toContain("- `vote(uint256 id)`");
    expect(lines).not.toContain("- `contributeWars(uint256 amount)`");
    expect(v2).toContain("0 Pay, 1 AddMember, 2 RemoveMember, 3 ReplaceMember, 4 SetWeeklyCap, 5 SetVotesRequired, 6 SetAgent, 7 Close, 8 GiveBack.");
    expect(v2).toContain("an ERC-20 `approve`");
    expect(v2).toContain("`convert` is the agent's: it swaps several members' dollars in one swap");
    // The share before the fee is `currencyOut`, and what's credited is that minus the fee.
    expect(v2).toContain("(that's `currencyOut` in their `Conversion`: their part of the swap, not the whole swap), takes the fee off it and credits the rest (`credited`)");
    expect(v2).toContain("The agent calls `convert`, `reimburseAgreedExpense` and `propose`, and sends `payFee` once a week");
    expect(v2).toContain("`GiveBack` pays a member back part of what they contributed, by vote, and lowers their `contributed` by as much");
    expect(v2).toContain("at most 10 proposals a week");
    expect(v2).toContain("560 bytes");
    expect(v2).toContain("`weeklyCap` can't exceed `balanceCap`");
  });

  it("says what version 2 lacks of version 1's, and which of its event arguments are named differently", async () => {
    const v2 = section(await GET().text(), "## Version 2");
    expect(v2).toContain("version 2 has no `contributeWars`, `contributeUsdt`, `balanceInWars` or `quoteUsdtInWars`");
    expect(v2).toContain("its `convert` is not version 1's `convert(uint256,uint256)`");
    expect(v2).toContain("`Contribution` has `credited` where version 1's has `creditedWars`");
    expect(v2).toContain("`MemberRemoved` has `currencyReturned` and `dollarReturned` (version 1: `warsReturned`, `usdtReturned`)");
    expect(v2).toContain("`FundClosed` and `RemainderDistributed` have `currencyBalance` and `dollarBalance` (version 1: `warsBalance`, `usdtBalance`)");
    expect(v2).toContain("`currencyOut` is that member's share of the swap");
  });

  it("says a version 2 fund takes any wFIAT as its currency, and which one the web creates today", async () => {
    const v2 = section(await GET().text(), "## Version 2");
    expect(v2).toContain("any wFIAT");
    expect(v2).toContain("`currency()`");
    expect(v2).toContain("the web creates them in wARS with USDT");
  });

  it("keeps version 1's rules as they were, marked as version 1's", async () => {
    const text = await GET().text();
    expect(section(text, "### USDT contributions in version 1")).toContain("credited to the member at once");
    expect(section(text, "## Functions")).toContain("- `contributeWars(uint256 amount)`");
    expect(section(text, "## Functions")).toContain("- `convert(uint256 usdtAmount, uint256 minWarsOut)`");
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

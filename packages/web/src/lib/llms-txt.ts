import {
  AGENT_ADDRESS,
  AGENT_ID,
  AGENT_URI,
  CELO_CHAIN_ID,
  DAY_BLOCKS,
  FUND_FACTORY,
  IDENTITY_REGISTRY,
  LIMITS,
  POOL,
  POOL_FEE,
  USDT,
  WARS,
  fundErrorAbi,
} from "@tesoreria/agent";
import { type Address, formatUnits, getAddress, toFunctionSelector } from "viem";
import { formatAbiItem } from "viem/utils";
import { USDT_UNIT, WARS_UNIT } from "./format";

const EXPLORER = "https://celo.blockscout.com";
const address = (account: Address) => `${EXPLORER}/address/${account}`;
const decimals = (unit: bigint) => unit.toString().length - 1;
const amount = (value: bigint, unit: bigint) => Number(formatUnits(value, decimals(unit))).toLocaleString("en-US");

/**
 * The site for an agent that reads it, in llmstxt.org's shape: the network, the contracts, the tokens, the
 * pool, the agent and its limits, the week's rule and Fund's errors, all from the constants the agent runs on. `origin`
 * is this site's; `publicFund`, the real group's fund the portada shows, if there is one.
 */
export function llmsTxt(origin: string, publicFund: Address | null): string {
  // An error's selector is its signature's hash, cut to 4 bytes, as a function's is.
  const errors = fundErrorAbi.map((error) => {
    const signature = formatAbiItem(error);
    return `- \`${signature}\` ${toFunctionSelector(signature)}`;
  });
  const fund = publicFund === null ? null : getAddress(publicFund);
  return `# TesorerIA

> A group's shared fund in Argentine pesos (wARS) on Celo, run by an agent within limits that a contract enforces. Members contribute wARS or USDT; the agent converts the USDT to wARS, pays members back for the expense the group agreed on, up to a weekly cap, and turns every other payment into a proposal the members vote on.

Every fund is its own contract, deployed by the FundFactory. The agent can only pay members, never above the weekly cap, and it can't change the rules. Everything else takes the votes the fund requires: any other payment, adding, removing or replacing a member, changing the weekly cap, the votes or the agent, and closing the fund. A member who leaves is voted out and takes their share of the fund, in proportion to what they contributed; closing the fund splits it the same way among the members.

## Network

- Celo mainnet, chain id ${CELO_CHAIN_ID}
- [Blockscout](${EXPLORER}): the explorer the addresses here link to

## Contracts

- [FundFactory](${address(FUND_FACTORY)}): deploys each group's Fund, and is verified
${
  fund === null
    ? ""
    : `- [A real group's fund](${address(fund)}): its Fund, with all it did on chain
- [Its public page](${origin}/f/${fund}/publico): the same fund on this site, read-only
`
}
## Tokens and market

- [wARS](${address(WARS)}): Ripio's Argentine peso, ${decimals(WARS_UNIT)} decimals
- [USDT](${address(USDT)}): ${decimals(USDT_UNIT)} decimals
- [The wARS/USDT pool](${address(POOL)}): Uniswap v3, fee tier ${POOL_FEE} (${POOL_FEE / 10_000} %), where the agent converts USDT to wARS

## Agent

- [Its wallet](${address(AGENT_ADDRESS)}): it pays gas in USDT and tags every transaction with celo_fbe4d00a2cb4
${
  AGENT_ID === null
    ? ""
    : `- [Its ERC-8004 identity](https://8004scan.io/agents/celo/${AGENT_ID}): agent ${AGENT_ID} in the [Identity Registry](${address(IDENTITY_REGISTRY)})
`
}- [Its ERC-8004 registration file](${AGENT_URI}): who it is, what it does and its limits, as JSON

### Its own limits

On top of the contract's, in each fund, where a day is the last ${Number(DAY_BLOCKS).toLocaleString("en-US")} blocks. A reimbursement over a limit becomes a proposal for the members to vote on, never a payment.

- At most ${amount(LIMITS.maxReimbursementWars, WARS_UNIT)} wARS per reimbursement, and ${amount(LIMITS.maxDailyReimbursedWars, WARS_UNIT)} wARS a day
- At most ${amount(LIMITS.maxConversionUsdt, USDT_UNIT)} USDT per conversion, and ${amount(LIMITS.maxDailyConvertedUsdt, USDT_UNIT)} USDT a day
- At most ${LIMITS.maxDailyTransactions} transactions a day

## The week

A fund's week is \`currentWeek() = (block.timestamp - startTime) / 7 days\`, where \`startTime\` is the \`block.timestamp\` of the fund's deployment, set in its constructor. So each fund's week turns at the day and time it was deployed, not at midnight. The weekly cap counts \`spentInWeek[currentWeek()]\`: what the agent reimbursed for the agreed expense in the current week.

## Errors

Fund's own errors, none with parameters, and their selectors:

${errors.join("\n")}

## Optional

- [Source code](https://github.com/ruizemanuel/TesorerIA): the contracts, the agent and this site
`;
}

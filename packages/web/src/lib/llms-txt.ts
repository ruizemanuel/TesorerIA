import {
  AGENT_ADDRESS,
  AGENT_ID,
  AGENT_URI,
  CELO_CHAIN_ID,
  DAY_BLOCKS,
  FEE_BPS,
  FEE_RECIPIENT,
  FUND_FACTORY,
  FUND_FACTORY_V2,
  IDENTITY_REGISTRY,
  LIMITS,
  POOL,
  POOL_FEE,
  TWAP_WINDOW,
  USDT,
  WARS,
  currencyOf,
  fundAbi,
  fundErrorAbi,
  fundV2Abi,
} from "@tesoreria/agent";
import { type Abi, type AbiFunction, type Address, formatUnits, getAddress, toFunctionSelector } from "viem";
import { formatAbiItem } from "viem/utils";
import { USDT_UNIT, WARS_UNIT } from "./format";
import { ProposalAction, memberFundAbi } from "./fund-abi";

/** `Fund.MAX_DEVIATION_BPS`, as a percentage: how far below the TWAP quote a conversion's minimum may be. */
const MAX_DEVIATION_PERCENT = 2;
/** `FundV2.MAX_FEE_BPS`, as a percentage: the most a fund may set aside from each contribution. */
const MAX_FEE_PERCENT = 1;
/** `FundV2.MAX_PROPOSALS_PER_WEEK`: what each member, and the agent, may propose in a week. */
const MAX_PROPOSALS_PER_WEEK = 10;
/** `FundV2.MAX_NOTE_BYTES`: the longest note of a proposal. */
const MAX_NOTE_BYTES = 560;
/** How many of `fundErrorAbi`'s errors are `Fund`'s: the rest are the ones `FundV2` adds. */
const FUND_ERRORS = 20;

/**
 * The functions of `abi`, once each, with their parameters' names: those that write to the fund (`calls`) and those
 * that only read it (`reads`).
 */
function listFunctions(abi: Abi): { calls: string[]; reads: string[] } {
  const functions = abi.filter((item): item is AbiFunction => item.type === "function");
  const list = (those: AbiFunction[]) => [...new Set(those.map((item) => `- \`${formatAbiItem(item, { includeName: true })}\``))];
  return {
    calls: list(functions.filter((item) => item.stateMutability !== "view")),
    reads: list(functions.filter((item) => item.stateMutability === "view")),
  };
}

/** The functions of `Fund` the agent or this site uses. */
const fundFunctions = () => listFunctions([...fundAbi, ...memberFundAbi]);

/**
 * The functions of `FundV2` that `Fund`'s list doesn't have, as that list writes them: what version 2 adds or changes
 * (`convert` takes the members whose dollars it converts), and none of what is the same.
 */
function fundV2Functions(): { calls: string[]; reads: string[] } {
  const v1 = fundFunctions();
  const known = new Set([...v1.calls, ...v1.reads]);
  const v2 = listFunctions(fundV2Abi);
  return { calls: v2.calls.filter((line) => !known.has(line)), reads: v2.reads.filter((line) => !known.has(line)) };
}

const EXPLORER = "https://celo.blockscout.com";
const address = (account: Address) => `${EXPLORER}/address/${account}`;
const decimals = (unit: bigint) => unit.toString().length - 1;
const amount = (value: bigint, unit: bigint) => Number(formatUnits(value, decimals(unit))).toLocaleString("en-US");

/**
 * The site for an agent that reads it, in llmstxt.org's shape: the network, the two factories, the tokens, the
 * pool, the agent and its limits, the week's rule, what version 2 changes and the errors of both versions, all from
 * the constants the agent runs on. `origin` is this site's; `publicFund`, the real group's fund the portada shows, if
 * there is one.
 */
export function llmsTxt(origin: string, publicFund: Address | null): string {
  // An error's selector is its signature's hash, cut to 4 bytes, as a function's is.
  const errorLine = (error: (typeof fundErrorAbi)[number]) => {
    const signature = formatAbiItem(error);
    return `- \`${signature}\` ${toFunctionSelector(signature)}`;
  };
  // Fund's come first in fundErrorAbi; the ones after them are FundV2's own.
  const errors = fundErrorAbi.slice(0, FUND_ERRORS).map(errorLine);
  const errorsV2 = fundErrorAbi.slice(FUND_ERRORS).map(errorLine);
  const fund = publicFund === null ? null : getAddress(publicFund);
  const functions = fundFunctions();
  const functionsV2 = fundV2Functions();
  // The agent's own limits this page gives are wARS's, from the table: it is still about the funds in wARS with USDT.
  const wars = currencyOf(WARS);
  if (wars === undefined) throw new Error("wARS is not in CURRENCIES");
  return `# TesorerIA

> A group's shared fund in Argentine pesos (wARS) on Celo, run by an agent within limits that a contract enforces. Members contribute wARS or USDT; the agent converts the USDT to wARS, pays members back for the expense the group agreed on, up to a weekly cap, and turns every other payment into a proposal the members vote on.

Every fund is its own contract, deployed by a factory: the FundFactory (version 1) or the FundFactoryV2 (version 2), which is where new funds come from. The agent can only pay members, never above the weekly cap, and it can't change the rules. Everything else takes the votes the fund requires: any other payment, adding, removing or replacing a member, changing the weekly cap, the votes or the agent, and closing the fund. A member who leaves is voted out and takes their share of the fund, in proportion to what they contributed; closing the fund splits it the same way among the members.

## Network

- Celo mainnet, chain id ${CELO_CHAIN_ID}
- [Blockscout](${EXPLORER}): the explorer the addresses here link to

## Contracts

- [FundFactory](${address(FUND_FACTORY)}): deploys each version 1 fund (\`Fund\`), and is verified
- [FundFactoryV2](${address(FUND_FACTORY_V2)}): deploys each version 2 fund (\`FundV2\`), the kind new funds are, and is verified
- Every fund they deployed: \`funds(i)\` for each \`i\` below \`fundCount()\`, on either factory
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

### Where the money comes from

Each member has an account on this site: a Safe smart account on Celo, which their passkey controls. They bring pesos as wARS from Ripio, or from any Celo wallet that holds wARS. From Ripio, in its app they withdraw wARS on the Celo network to that account, or they load them from the fund's screen. Or they send USDT on Celo from any exchange. The wARS the agent pays a member back, they can pass to their own Ripio account and sell them 1:1 for pesos there.

### USDT contributions in version 1

In a version 1 fund, a USDT contribution is credited to the member at once, in wARS, at the pool's ${TWAP_WINDOW / 60}-minute TWAP: that's \`creditedWars\` in \`Contribution\`, and what the contract counts, also when it splits the fund at the close. The agent then converts the USDT with \`convert\`, whose minimum can't be more than ${MAX_DEVIATION_PERCENT} % below the TWAP quote. What the swap gets is \`warsOut\` in \`Conversion\`. Toward a member's dues, this site counts each USDT contribution at what its conversion got, matching conversions to USDT contributions in order of arrival: the member who contributed that USDT covers the difference from what was credited, or keeps it if the swap got more. Until it's converted, it counts at what was credited. What's left to pay under 0.5 % of the weekly fee isn't called a debt; it goes with the next week's.

## Agent

- [Its wallet](${address(AGENT_ADDRESS)}): it pays gas in USDT and tags every transaction with celo_fbe4d00a2cb4
${
  AGENT_ID === null
    ? ""
    : `- [Its ERC-8004 identity](https://8004scan.io/agents/celo/${AGENT_ID}): agent ${AGENT_ID} in the [Identity Registry](${address(IDENTITY_REGISTRY)})
`
}- [Its ERC-8004 registration file](${AGENT_URI}): who it is, what it does and its limits, as JSON

### Its own limits

On top of the contract's, in each fund, where a day is the last ${Number(DAY_BLOCKS).toLocaleString("en-US")} blocks. A reimbursement over a limit becomes a proposal for the members to vote on, never a payment. They live in the agent's code, not in the contract, so the chain can't check them the way it checks the contract's.

- At most ${amount(wars.limits.reimbursement, WARS_UNIT)} wARS per reimbursement, and ${amount(wars.limits.dailyReimbursed, WARS_UNIT)} wARS a day
- At most ${LIMITS.maxConversionDollar.toLocaleString("en-US")} USDT per conversion, and ${LIMITS.maxDailyConvertedDollar.toLocaleString("en-US")} USDT a day
- At most ${LIMITS.maxDailyTransactions} transactions a day

## The week

A fund's week is \`currentWeek() = (block.timestamp - startTime) / 7 days\`, where \`startTime\` is the \`block.timestamp\` of the fund's deployment, set in its constructor. So each fund's week turns at the day and time it was deployed, not at midnight. The weekly cap counts \`spentInWeek[currentWeek()]\`: what the agent reimbursed for the agreed expense in the current week.

The contract counts weeks from 0, and so does the \`week\` in \`Reimbursement\`. This site's weekly summaries count them from 1, as people do: its week N is the contract's week N − 1.

## Functions

The ones of \`Fund\` (version 1) the agent and this site call. Members call \`contributeWars\`, \`contributeUsdt\`, \`propose\` and \`vote\`, and a contribution needs an ERC-20 \`approve\` of the fund first. The agent calls \`convert\`, \`reimburseAgreedExpense\` and \`propose\`. A member's proposal counts their vote at once; the agent's starts with none. And anyone can call \`execute\` once a proposal has the votes it needs.

${functions.calls.join("\n")}

And what they read, which anyone can:

${functions.reads.join("\n")}

\`propose\`'s \`action\` is \`Fund.Action\`: ${Object.entries(ProposalAction)
    // GiveBack is FundV2's only: Fund.Action ends at Close.
    .filter(([, value]) => value !== ProposalAction.GiveBack)
    .map(([name, value]) => `${value} ${name}`)
    .join(", ")}.

## Version 2

A version 2 fund (\`FundV2\`, deployed by the [FundFactoryV2](${address(FUND_FACTORY_V2)})) is what new funds are: the web creates them. What is not said here works as in the sections above.

- **Any currency.** A fund's currency is a parameter of \`createFund\`: any wFIAT, with or without a dollar and the Uniswap v3 pool of the two. Read them with \`currency()\`, \`dollar()\` and \`pool()\`. A fund without a dollar takes only its currency. Version 2 funds can use any wFIAT, and the web creates them in wARS with USDT today.
- **USDT is pending until it is converted.** A USDT contribution is not credited when it arrives: it stays pending, in \`pendingDollar(address)\` (the sum is \`totalPendingDollar()\`), until the agent converts it. Then each member is credited at what the conversion really got, net of the fee: that's \`credited\` in \`Conversion\`, which comes once per member. \`Contribution\` carries \`credited\` = 0 for USDT. A member voted out gets their pending USDT back, and a replacement account takes it over.
- **Conversion.** \`convert\` is the agent's: it swaps several members' dollars in one swap, with the same floor as version 1 (its minimum can't be more than ${MAX_DEVIATION_PERCENT} % below the TWAP quote of the whole amount), and credits each member \`received * amount / total\`, rounded down. A swap that doesn't take all the dollars reverts.
- **The fee.** New funds keep ${FEE_BPS / 100} % for gas: each fund has a \`feeBps\`, fixed when it's created (the contract allows up to ${MAX_FEE_PERCENT} %; the web sets ${FEE_BPS / 100} %), and sets that share aside, in its currency, from every contribution and every converted share. What is set aside is \`feeOwed\`; \`contributed\` counts what is left; \`availableCurrency()\` is what the fund can pay or split, its balance of the currency minus \`feeOwed\`. And anyone can call \`payFee\` to send \`feeOwed\` to the [fee recipient](${address(FEE_RECIPIENT)}), with the fund open or closed.
- **\`GiveBack\`.** \`GiveBack\` pays a member back part of what they contributed, by vote, and lowers their \`contributed\` by as much, so their share if they leave or the fund closes is right.
- **Limits.** Each member, and the agent, can make at most ${MAX_PROPOSALS_PER_WEEK} proposals a week, counted from zero again each week (\`proposalsInWeek\`), with notes of at most ${MAX_NOTE_BYTES} bytes. \`weeklyCap\` can't exceed \`balanceCap\`, which counts the available currency and the pending dollars, at the TWAP.

Members call \`contribute\`, \`contributeDollar\`, \`propose\` and \`vote\`, and a contribution needs an ERC-20 \`approve\` of the fund first. The agent calls \`convert\`, \`reimburseAgreedExpense\` and \`propose\`. Anyone can call \`execute\` once a proposal has the votes it needs. What version 2 adds or changes:

${functionsV2.calls.join("\n")}

And what it reads:

${functionsV2.reads.join("\n")}

\`propose\`'s \`action\` is \`FundV2.Action\`: ${Object.entries(ProposalAction)
    .map(([name, value]) => `${value} ${name}`)
    .join(", ")}.

Its events keep version 1's, except \`Conversion(member, dollarIn, currencyOut, credited)\`, and add \`ContributionGivenBack(member, amount)\` and \`FeePaid(amount)\`.

## Errors

The errors of \`Fund\` (version 1), none with parameters, and their selectors. \`FundV2\` has them all too, and five more:

${errors.join("\n")}

The five \`FundV2\` adds:

${errorsV2.join("\n")}

## On this site

Pages answer in Spanish or in English: the \`lang\` cookie (\`es\` or \`en\`) that the ES · EN switch sets, or else the Accept-Language header. A fund's pages, where \`<fund>\` is its address:

- \`${origin}/f/<fund>/publico\`: its public page, read-only, if its group turned it on
- \`${origin}/f/<fund>/publico/movimientos\`: all its movements
- \`${origin}/f/<fund>/publico?p=resumen&semana=<N>\`: the summary of its week N, counted from 1
- \`${origin}/f/<fund>/publico?p=comprobante&id=<transaction hash>:<log index>\`: one movement's receipt

## Optional

- [Source code](https://github.com/ruizemanuel/TesorerIA): the contracts, the agent and this site
`;
}

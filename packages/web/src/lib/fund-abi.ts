import { parseAbi } from "viem";
import { WARS_UNIT } from "./format";

/** The parts of `Fund` the web reads and members call, beyond @tesoreria/agent's fundAbi (contracts/src/Fund.sol). */
export const memberFundAbi = parseAbi([
  "function name() view returns (string)",
  "function agreedExpense() view returns (string)",
  "function balanceCap() view returns (uint256)",
  "function balanceInWars() view returns (uint256)",
  "function quoteUsdtInWars(uint256 usdtAmount) view returns (uint256)",
  "function getProposal(uint256 id) view returns ((uint8 action, address a, address b, uint256 amount, uint64 deadline, bool executed, address proposer, string note))",
  "function voteCount(uint256 id) view returns (uint256)",
  "function hasVoted(uint256 id, address member) view returns (bool)",
  "function contributeWars(uint256 amount)",
  "function contributeUsdt(uint256 amount)",
  "function vote(uint256 id)",
  "function execute(uint256 id)",
]);

/**
 * The cap every fund the web makes live has on its balance, the spec's default (4): about US$ 300. `funds.ts` refuses to
 * go live with any other, so Aportar can count on it.
 */
export const DEFAULT_BALANCE_CAP = 450_000n * WARS_UNIT;

/** `Fund.Action`, in the contract's order (spec, 16). */
export const ProposalAction = {
  Pay: 0,
  AddMember: 1,
  RemoveMember: 2,
  ReplaceMember: 3,
  SetWeeklyCap: 4,
  SetVotesRequired: 5,
  SetAgent: 6,
  Close: 7,
} as const;

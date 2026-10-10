import { parseAbi } from "viem";

/** The parts of `Fund` the web reads and members call, beyond @tesoreria/agent's fundAbi (contracts/src/Fund.sol). */
export const memberFundAbi = parseAbi([
  "function name() view returns (string)",
  "function agreedExpense() view returns (string)",
  "function balanceCap() view returns (uint256)",
  "function balanceInWars() view returns (uint256)",
  "function getProposal(uint256 id) view returns ((uint8 action, address a, address b, uint256 amount, uint64 deadline, bool executed, address proposer, string note))",
  "function voteCount(uint256 id) view returns (uint256)",
  "function hasVoted(uint256 id, address member) view returns (bool)",
  "function contributeWars(uint256 amount)",
  "function contributeUsdt(uint256 amount)",
  "function vote(uint256 id)",
  "function execute(uint256 id)",
]);

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

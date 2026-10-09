import { parseAbi } from "viem";

/** The parts of `Fund` the agent reads, calls and decodes (contracts/src/Fund.sol). */
export const fundAbi = parseAbi([
  "function agent() view returns (address)",
  "function closed() view returns (bool)",
  "function members() view returns (address[])",
  "function votesRequired() view returns (uint8)",
  "function weeklyCap() view returns (uint256)",
  "function startTime() view returns (uint256)",
  "function currentWeek() view returns (uint256)",
  "function spentInWeek(uint256) view returns (uint256)",
  "function contributed(address) view returns (uint256)",
  "function totalContributed() view returns (uint256)",
  "function quoteUsdtInWars(uint256 usdtAmount) view returns (uint256)",
  "function convert(uint256 usdtAmount, uint256 minWarsOut) returns (uint256 received)",
  "function reimburseAgreedExpense(address member, uint256 amount, bytes32 ref)",
  "function propose(uint8 action, address a, address b, uint256 amount, string note) returns (uint256 id)",
  "event Contribution(address indexed member, address indexed token, uint256 amount, uint256 creditedWars)",
  "event Conversion(uint256 usdtIn, uint256 warsOut)",
  "event Reimbursement(address indexed member, uint256 amount, bytes32 ref, uint256 week)",
  "event ProposalCreated(uint256 indexed id, uint8 action, address a, address b, uint256 amount, address indexed proposer, string note)",
  "event VoteCast(uint256 indexed id, address indexed member)",
  "event ProposalExecuted(uint256 indexed id)",
  "event Payment(address indexed member, uint256 amount)",
  "event MemberAdded(address indexed member)",
  "event MemberRemoved(address indexed member, uint256 warsReturned, uint256 usdtReturned)",
  "event MemberReplaced(address indexed oldMember, address indexed newMember)",
  "event WeeklyCapChanged(uint256 cap)",
  "event VotesRequiredChanged(uint8 votes)",
  "event AgentChanged(address indexed agent)",
  "event FundClosed(uint256 warsBalance, uint256 usdtBalance)",
  "event RemainderDistributed(uint256 warsBalance, uint256 usdtBalance)",
]);

/** `Fund.Action`, in the contract's order. The agent only ever proposes `Pay`. */
export const Action = { Pay: 0 } as const;

/** The parts of `FundFactory` the agent and its tests use (contracts/src/FundFactory.sol). */
export const fundFactoryAbi = parseAbi([
  "function fundCount() view returns (uint256)",
  "function funds(uint256) view returns (address)",
  "function createFund((string name, address[] members, uint8 votesRequired, address agent, string agreedExpense, uint256 weeklyCap, uint256 balanceCap) p) returns (address fund)",
  "event FundCreated(address indexed fund, address indexed creator, string name)",
]);

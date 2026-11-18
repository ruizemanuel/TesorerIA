import { parseAbi } from "viem";

/** Every event of `Fund` (contracts/src/Fund.sol): what `fundAbi` decodes, and what `fundEventAbi` starts from. */
const fundEvents = [
  "event Contribution(address indexed member, address indexed token, uint256 amount, uint256 credited)",
  "event Conversion(uint256 dollarIn, uint256 currencyOut)",
  "event Reimbursement(address indexed member, uint256 amount, bytes32 ref, uint256 week)",
  "event ProposalCreated(uint256 indexed id, uint8 action, address a, address b, uint256 amount, address indexed proposer, string note)",
  "event VoteCast(uint256 indexed id, address indexed member)",
  "event ProposalExecuted(uint256 indexed id)",
  "event Payment(address indexed member, uint256 amount)",
  "event MemberAdded(address indexed member)",
  "event MemberRemoved(address indexed member, uint256 currencyReturned, uint256 dollarReturned)",
  "event MemberReplaced(address indexed oldMember, address indexed newMember)",
  "event WeeklyCapChanged(uint256 cap)",
  "event VotesRequiredChanged(uint8 votes)",
  "event AgentChanged(address indexed agent)",
  "event FundClosed(uint256 currencyBalance, uint256 dollarBalance)",
  "event RemainderDistributed(uint256 currencyBalance, uint256 dollarBalance)",
] as const;

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
  "function proposalCount() view returns (uint256)",
  "function quoteUsdtInWars(uint256 usdtAmount) view returns (uint256)",
  "function convert(uint256 usdtAmount, uint256 minWarsOut) returns (uint256 received)",
  "function reimburseAgreedExpense(address member, uint256 amount, bytes32 ref)",
  "function propose(uint8 action, address a, address b, uint256 amount, string note) returns (uint256 id)",
  ...fundEvents,
]);

/**
 * The parts of `FundV2` the agent and the web read, call and decode (contracts/src/FundV2.sol): what `fundAbi` has of
 * `Fund`, and what version 2 adds: the fee, the pending dollars, the conversion for several members, `GiveBack`.
 */
export const fundV2Abi = parseAbi([
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
  "function proposalCount() view returns (uint256)",
  "function name() view returns (string)",
  "function agreedExpense() view returns (string)",
  "function balanceCap() view returns (uint256)",
  "function getProposal(uint256 id) view returns ((uint8 action, address a, address b, uint256 amount, uint64 deadline, bool executed, address proposer, string note))",
  "function voteCount(uint256 id) view returns (uint256)",
  "function hasVoted(uint256 id, address member) view returns (bool)",
  "function isMember(address member) view returns (bool)",
  "function currency() view returns (address)",
  "function dollar() view returns (address)",
  "function pool() view returns (address)",
  "function feeBps() view returns (uint16)",
  "function feeOwed() view returns (uint256)",
  "function availableCurrency() view returns (uint256)",
  "function balanceInCurrency() view returns (uint256)",
  "function quoteDollar(uint256 dollarAmount) view returns (uint256)",
  "function pendingDollar(address) view returns (uint256)",
  "function totalPendingDollar() view returns (uint256)",
  "function proposalsInWeek(uint256 week, address) view returns (uint256)",
  "function contribute(uint256 amount)",
  "function contributeDollar(uint256 amount)",
  "function convert(address[] members_, uint256[] dollarAmounts, uint256 minCurrencyOut) returns (uint256 received)",
  "function reimburseAgreedExpense(address member, uint256 amount, bytes32 ref)",
  "function propose(uint8 action, address a, address b, uint256 amount, string note) returns (uint256 id)",
  "function vote(uint256 id)",
  "function execute(uint256 id)",
  "function payFee()",
  "event Contribution(address indexed member, address indexed token, uint256 amount, uint256 credited)",
  "event Conversion(address indexed member, uint256 dollarIn, uint256 currencyOut, uint256 credited)",
  "event ContributionGivenBack(address indexed member, uint256 amount)",
  "event FeePaid(uint256 amount)",
  "event Reimbursement(address indexed member, uint256 amount, bytes32 ref, uint256 week)",
  "event ProposalCreated(uint256 indexed id, uint8 action, address a, address b, uint256 amount, address indexed proposer, string note)",
  "event VoteCast(uint256 indexed id, address indexed member)",
  "event ProposalExecuted(uint256 indexed id)",
  "event Payment(address indexed member, uint256 amount)",
  "event MemberAdded(address indexed member)",
  "event MemberRemoved(address indexed member, uint256 currencyReturned, uint256 dollarReturned)",
  "event MemberReplaced(address indexed oldMember, address indexed newMember)",
  "event WeeklyCapChanged(uint256 cap)",
  "event VotesRequiredChanged(uint8 votes)",
  "event AgentChanged(address indexed agent)",
  "event FundClosed(uint256 currencyBalance, uint256 dollarBalance)",
  "event RemainderDistributed(uint256 currencyBalance, uint256 dollarBalance)",
]);

/**
 * Every event of either version, each once: what the funds' logs decode with. Version 2's `Contribution`,
 * `MemberRemoved` and the rest have the types of version 1's, so they are the same entry. The two `Conversion`s
 * differ (version 2's names its member and what it credited), so both are here, and a decoded one is told apart by
 * `"member" in event.args`.
 */
export const fundEventAbi = parseAbi([
  ...fundEvents,
  "event Conversion(address indexed member, uint256 dollarIn, uint256 currencyOut, uint256 credited)",
  "event ContributionGivenBack(address indexed member, uint256 amount)",
  "event FeePaid(uint256 amount)",
]);

/**
 * Every error `Fund` declares, in its order, then the five `FundV2` adds, without their libraries'
 * (contracts/src/Fund.sol, contracts/src/FundV2.sol): what a revert of either decodes to.
 */
export const fundErrorAbi = parseAbi([
  "error InvalidParams()",
  "error NotMember()",
  "error OnlyAgent()",
  "error OnlyMemberOrAgent()",
  "error FundIsClosed()",
  "error ZeroAmount()",
  "error BalanceCapExceeded()",
  "error WeeklyCapExceeded()",
  "error InsufficientBalance()",
  "error RecipientNotMember()",
  "error MinOutTooLow()",
  "error InsufficientOutput()",
  "error OnlyPool()",
  "error ProposalNotFound()",
  "error ProposalExpired()",
  "error ProposalAlreadyExecuted()",
  "error AlreadyVoted()",
  "error NotEnoughVotes()",
  "error SwapOverpayment()",
  "error FundNotClosed()",
  "error NoDollar()",
  "error InsufficientPending()",
  "error GiveBackTooLarge()",
  "error TooManyProposals()",
  "error NoteTooLong()",
]);

/**
 * `Fund.Action` and `FundV2.Action`, in the contracts' order (the first eight are the same). The agent only ever
 * proposes `Pay`, and `GiveBack` exists in version 2 only.
 */
export const Action = { Pay: 0, GiveBack: 8 } as const;

/** The parts of `FundFactory` the agent and its tests use (contracts/src/FundFactory.sol). */
export const fundFactoryAbi = parseAbi([
  "function fundCount() view returns (uint256)",
  "function funds(uint256) view returns (address)",
  "function createFund((string name, address[] members, uint8 votesRequired, address agent, string agreedExpense, uint256 weeklyCap, uint256 balanceCap) p) returns (address fund)",
  "event FundCreated(address indexed fund, address indexed creator, string name)",
]);

/** The parts of `FundFactoryV2` the agent, the web and their tests use (contracts/src/FundFactoryV2.sol). */
export const fundFactoryV2Abi = parseAbi([
  "function fundCount() view returns (uint256)",
  "function funds(uint256) view returns (address)",
  "function uniswapFactory() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function createFund((string name, address[] members, uint8 votesRequired, address agent, string agreedExpense, uint256 weeklyCap, uint256 balanceCap, address currency, address dollar, address pool, uint16 feeBps) p) returns (address fund)",
  "event FundCreated(address indexed fund, address indexed creator, address indexed currency, address dollar, string name)",
]);

// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

/// @title TesorerIA fund, version 2
/// @notice A group's shared fund in any wFIAT (its currency). No one in the group holds the money: the agent can only
///         reimburse the agreed expense up to a weekly cap, always to members, and, if the fund has a dollar entry,
///         convert the dollars members contributed into the currency. Everything else is voted on. Each fund keeps
///         a fee, fixed when it is created, that is set aside from every contribution.
/// @dev Version 2 sits next to `Fund` (version 1), which stays as deployed. Created by `FundFactoryV2`.
contract FundV2 is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- Constants
    uint256 public constant MIN_MEMBERS = 3;
    uint256 public constant MAX_MEMBERS = 10;
    uint256 public constant MIN_VOTES = 2;
    uint32 public constant TWAP_WINDOW = 30 minutes;
    uint256 public constant MAX_DEVIATION_BPS = 200;
    uint256 public constant BPS = 10_000;
    uint256 public constant WEEK = 7 days;
    uint256 public constant PROPOSAL_DURATION = 7 days;
    uint256 public constant MAX_FEE_BPS = 100;
    uint256 public constant MAX_PROPOSALS_PER_WEEK = 10;
    uint256 public constant MAX_NOTE_BYTES = 560;

    // ---------------------------------------------------------------- Types
    /// @param dollar The token members may contribute to be converted into `currency`; zero for a fund with no dollar
    ///        entry, which must then have no `pool` either.
    /// @param pool The Uniswap v3 pool of `currency` and `dollar` that prices and executes the conversions.
    /// @param feeBps The share of each contribution set aside as the fee, in basis points, up to `MAX_FEE_BPS`.
    struct Params {
        string name;
        address[] members;
        uint8 votesRequired;
        address agent;
        string agreedExpense;
        uint256 weeklyCap;
        uint256 balanceCap;
        IERC20 currency;
        IERC20 dollar;
        IUniswapV3Pool pool;
        uint16 feeBps;
    }

    /// @dev The first eight are the same, in the same order, as in `Fund`; `GiveBack` is new.
    enum Action {
        Pay,
        AddMember,
        RemoveMember,
        ReplaceMember,
        SetWeeklyCap,
        SetVotesRequired,
        SetAgent,
        Close,
        GiveBack
    }

    struct Proposal {
        Action action;
        address a;
        address b;
        uint256 amount;
        uint64 deadline;
        bool executed;
        address proposer;
        string note;
    }

    // ---------------------------------------------------------------- Errors
    error InvalidParams();
    error NotMember();
    error OnlyAgent();
    error OnlyMemberOrAgent();
    error FundIsClosed();
    error ZeroAmount();
    error BalanceCapExceeded();
    error WeeklyCapExceeded();
    error InsufficientBalance();
    error RecipientNotMember();
    error MinOutTooLow();
    error InsufficientOutput();
    error OnlyPool();
    error ProposalNotFound();
    error ProposalExpired();
    error ProposalAlreadyExecuted();
    error AlreadyVoted();
    error NotEnoughVotes();
    error SwapOverpayment();
    error FundNotClosed();
    error NoDollar();
    error InsufficientPending();
    error GiveBackTooLarge();
    error TooManyProposals();
    error NoteTooLong();

    // ---------------------------------------------------------------- Events
    /// @dev `credited` is what counts toward the member's share: the net amount in the currency, and zero for dollars,
    ///      which are credited when they are converted.
    event Contribution(address indexed member, address indexed token, uint256 amount, uint256 credited);
    event Conversion(address indexed member, uint256 dollarIn, uint256 currencyOut, uint256 credited);
    event ContributionGivenBack(address indexed member, uint256 amount);
    event FeePaid(uint256 amount);
    event Reimbursement(address indexed member, uint256 amount, bytes32 ref, uint256 week);
    event ProposalCreated(
        uint256 indexed id, Action action, address a, address b, uint256 amount, address indexed proposer, string note
    );
    event VoteCast(uint256 indexed id, address indexed member);
    event ProposalExecuted(uint256 indexed id);
    event Payment(address indexed member, uint256 amount);
    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member, uint256 currencyReturned, uint256 dollarReturned);
    event MemberReplaced(address indexed oldMember, address indexed newMember);
    event WeeklyCapChanged(uint256 cap);
    event VotesRequiredChanged(uint8 votes);
    event AgentChanged(address indexed agent);
    event FundClosed(uint256 currencyBalance, uint256 dollarBalance);
    event RemainderDistributed(uint256 currencyBalance, uint256 dollarBalance);

    // ---------------------------------------------------------------- State
    IERC20 public immutable currency;
    IERC20 public immutable dollar;
    IUniswapV3Pool public immutable pool;
    address public immutable feeRecipient;
    uint16 public immutable feeBps;
    uint256 public immutable startTime;
    uint256 public immutable balanceCap;
    bool private immutable _dollarIsToken0;

    string public name;
    string public agreedExpense;
    uint256 public weeklyCap;
    uint8 public votesRequired;
    address public agent;
    bool public closed;

    address[] private _members;
    mapping(address => bool) public isMember;
    mapping(address => uint256) public contributed;
    uint256 public totalContributed;
    /// @notice Dollars a member contributed that haven't been converted yet.
    mapping(address => uint256) public pendingDollar;
    uint256 public totalPendingDollar;
    /// @notice The fee set aside in the currency and not yet sent to `feeRecipient` by `payFee`. It is never part of
    ///         what the fund can pay or split.
    uint256 public feeOwed;
    mapping(uint256 => uint256) public spentInWeek;

    Proposal[] private _proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 week => mapping(address => uint256)) public proposalsInWeek;

    // ---------------------------------------------------------------- Modifiers
    modifier onlyMember() {
        if (!isMember[msg.sender]) revert NotMember();
        _;
    }

    modifier whenOpen() {
        if (closed) revert FundIsClosed();
        _;
    }

    // ---------------------------------------------------------------- Creation
    /// @dev Validates the whole shape of the fund; `FundFactoryV2` checks the pool against Uniswap's factory afterwards.
    constructor(Params memory p, address feeRecipient_) {
        uint256 n = p.members.length;
        if (
            n < MIN_MEMBERS || n > MAX_MEMBERS || p.votesRequired < MIN_VOTES || p.votesRequired >= n
                || p.agent == address(0) || p.balanceCap == 0 || p.weeklyCap > p.balanceCap || p.feeBps > MAX_FEE_BPS
                || feeRecipient_ == address(0) || address(p.currency) == address(0)
                || address(p.dollar) == address(p.currency)
                || (address(p.dollar) == address(0)) != (address(p.pool) == address(0))
        ) revert InvalidParams();
        bool dollarIsToken0 = false;
        if (address(p.pool) != address(0)) {
            address t0 = p.pool.token0();
            address t1 = p.pool.token1();
            bool dollarFirst = t0 == address(p.dollar) && t1 == address(p.currency);
            bool currencyFirst = t0 == address(p.currency) && t1 == address(p.dollar);
            if (!dollarFirst && !currencyFirst) revert InvalidParams();
            dollarIsToken0 = dollarFirst;
        }
        for (uint256 i; i < n; ++i) {
            address m = p.members[i];
            if (m == address(0) || m == p.agent || isMember[m]) revert InvalidParams();
            isMember[m] = true;
            _members.push(m);
        }
        currency = p.currency;
        dollar = p.dollar;
        pool = p.pool;
        feeRecipient = feeRecipient_;
        feeBps = p.feeBps;
        _dollarIsToken0 = dollarIsToken0;
        startTime = block.timestamp;
        balanceCap = p.balanceCap;
        name = p.name;
        agreedExpense = p.agreedExpense;
        weeklyCap = p.weeklyCap;
        votesRequired = p.votesRequired;
        agent = p.agent;
    }

    // ---------------------------------------------------------------- Views
    function members() external view returns (address[] memory) {
        return _members;
    }

    function currentWeek() public view returns (uint256) {
        return (block.timestamp - startTime) / WEEK;
    }

    /// @notice The currency the fund can pay or split: its balance minus the fee set aside.
    function availableCurrency() public view returns (uint256) {
        return currency.balanceOf(address(this)) - feeOwed;
    }

    /// @notice The fund's total balance in the currency.
    function balanceInCurrency() public view returns (uint256) {
        return availableCurrency();
    }

    // ---------------------------------------------------------------- Contributions
    /// @notice Contribute `amount` of the currency. The fee is set aside from what arrives, and the rest is credited
    ///         to the member.
    function contribute(uint256 amount) external onlyMember whenOpen nonReentrant {
        uint256 received = _pullTokens(currency, amount);
        uint256 fee = received * feeBps / BPS;
        uint256 credited = received - fee;
        feeOwed += fee;
        contributed[msg.sender] += credited;
        totalContributed += credited;
        if (balanceInCurrency() > balanceCap) revert BalanceCapExceeded();
        emit Contribution(msg.sender, address(currency), received, credited);
    }

    /// @dev Measures what arrived by balance difference, within the call (the spec's CIP-64 rule).
    function _pullTokens(IERC20 token, uint256 amount) internal returns (uint256) {
        if (amount == 0) revert ZeroAmount();
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        return token.balanceOf(address(this)) - balanceBefore;
    }

    // ---------------------------------------------------------------- Fee
    /// @notice Send the fee set aside to `feeRecipient`. Anyone may call it, with the fund open or closed.
    function payFee() external nonReentrant {
        uint256 owed = feeOwed;
        if (owed == 0) revert ZeroAmount();
        feeOwed = 0;
        currency.safeTransfer(feeRecipient, owed);
        emit FeePaid(owed);
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IUniswapV3SwapCallback} from "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import {TickMath} from "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import {OracleLibrary} from "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";

/// @title TesorerIA fund, version 2
/// @notice A group's shared fund in any wFIAT (its currency). No one in the group holds the money: the agent can only
///         reimburse the agreed expense up to a weekly cap, always to members, and, if the fund has a dollar entry,
///         convert the dollars members contributed into the currency. Everything else is voted on. Each fund keeps
///         a fee, fixed when it is created, that is set aside from every contribution.
/// @dev Version 2 sits next to `Fund` (version 1), which stays as deployed. Created by `FundFactoryV2`.
contract FundV2 is ReentrancyGuardTransient, IUniswapV3SwapCallback {
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

    /// @dev Dollars the pool may still collect in the current conversion; zero outside `convert`.
    uint256 private transient _swapDollarLimit;

    // ---------------------------------------------------------------- Modifiers
    modifier onlyMember() {
        if (!isMember[msg.sender]) revert NotMember();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert OnlyAgent();
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

    /// @notice How much of the currency `dollarAmount` is worth at the pool's 30-minute TWAP.
    /// @dev Reverts with `NoDollar` in a fund with no dollar. It returns 0 for 0 without reading the pool, and, as in
    ///      version 1, reverts with `InvalidParams` above `type(uint128).max`.
    function quoteDollar(uint256 dollarAmount) public view returns (uint256) {
        if (address(dollar) == address(0)) revert NoDollar();
        if (dollarAmount == 0) return 0;
        if (dollarAmount > type(uint128).max) revert InvalidParams();
        return OracleLibrary.getQuoteAtTick(_averageTick(), uint128(dollarAmount), address(dollar), address(currency));
    }

    /// @notice The fund's total balance in the currency: what it can pay or split, plus every dollar it holds (the
    ///         pending ones and any sent to it directly) valued at the TWAP. A fund with no dollar never reads a pool.
    function balanceInCurrency() public view returns (uint256) {
        uint256 available = availableCurrency();
        if (address(dollar) == address(0)) return available;
        return available + quoteDollar(dollar.balanceOf(address(this)));
    }

    function _averageTick() internal view returns (int24 t) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = TWAP_WINDOW;
        (int56[] memory tickCumulatives,) = pool.observe(secondsAgos);
        int56 delta = tickCumulatives[1] - tickCumulatives[0];
        t = int24(delta / int56(uint56(TWAP_WINDOW)));
        if (delta < 0 && (delta % int56(uint56(TWAP_WINDOW)) != 0)) t--;
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

    /// @notice Contribute `amount` of the dollar. It is held as the member's pending dollars, and is credited to them
    ///         (net of the fee) only when the agent converts it into the currency.
    function contributeDollar(uint256 amount) external onlyMember whenOpen nonReentrant {
        if (address(dollar) == address(0)) revert NoDollar();
        uint256 received = _pullTokens(dollar, amount);
        pendingDollar[msg.sender] += received;
        totalPendingDollar += received;
        if (balanceInCurrency() > balanceCap) revert BalanceCapExceeded();
        emit Contribution(msg.sender, address(dollar), received, 0);
    }

    /// @dev Measures what arrived by balance difference, within the call (the spec's CIP-64 rule).
    function _pullTokens(IERC20 token, uint256 amount) internal returns (uint256) {
        if (amount == 0) revert ZeroAmount();
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        return token.balanceOf(address(this)) - balanceBefore;
    }

    // ---------------------------------------------------------------- Conversion (agent)
    /// @notice Swaps the dollars of several members for the currency in one swap, and credits each of them their share
    ///         of what arrives, net of the fee. `minCurrencyOut` can't be more than 2% below the TWAP quote of the
    ///         whole `sum(dollarAmounts)`, and what arrives can't be less than `minCurrencyOut`. It reverts with
    ///         `InsufficientOutput` if the pool takes less than all of the dollars (a partial fill).
    /// @dev Each member's share is `received * amount / total`, rounded down, so what is credited plus what is set
    ///      aside as the fee never exceeds `received`. What rounding leaves over belongs to no member: it stays in the
    ///      fund, in what it can pay or split.
    /// @param members_ The members whose pending dollars are converted, with no repeats.
    /// @param dollarAmounts How much of each member's pending dollars to convert, in the same order.
    /// @return received What the swap delivered, in the currency.
    function convert(address[] calldata members_, uint256[] calldata dollarAmounts, uint256 minCurrencyOut)
        external
        onlyAgent
        whenOpen
        nonReentrant
        returns (uint256 received)
    {
        if (address(dollar) == address(0)) revert NoDollar();
        uint256 total = _takePending(members_, dollarAmounts);
        uint256 expected = quoteDollar(total);
        if (minCurrencyOut < expected * (BPS - MAX_DEVIATION_BPS) / BPS) revert MinOutTooLow();

        bool zeroForOne = _dollarIsToken0;
        uint256 balanceBefore = currency.balanceOf(address(this));
        uint256 dollarBefore = dollar.balanceOf(address(this));
        _swapDollarLimit = total;
        pool.swap(
            address(this),
            zeroForOne,
            int256(total),
            zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1,
            ""
        );
        _swapDollarLimit = 0;
        // A pool that runs out of liquidity before the price limit fills only part of the swap. The members were
        // debited for all of `total`, so the swap must have taken all of it, or what is left would be dollars no
        // member has pending.
        if (dollarBefore - dollar.balanceOf(address(this)) != total) revert InsufficientOutput();
        received = currency.balanceOf(address(this)) - balanceBefore;
        if (received < minCurrencyOut) revert InsufficientOutput();

        _creditShares(members_, dollarAmounts, received, total);
    }

    /// @dev Validates the two lists and takes each member's amount off their pending dollars. Returns the total.
    function _takePending(address[] calldata members_, uint256[] calldata dollarAmounts)
        private
        returns (uint256 total)
    {
        uint256 n = members_.length;
        if (n == 0 || n != dollarAmounts.length) revert InvalidParams();
        for (uint256 i; i < n; ++i) {
            address member = members_[i];
            uint256 amount = dollarAmounts[i];
            if (amount == 0) revert ZeroAmount();
            // Each entry must be a distinct member with dollars pending, so no more than MAX_MEMBERS get this far and
            // a pairwise check for repeats is cheap.
            for (uint256 j; j < i; ++j) {
                if (members_[j] == member) revert InvalidParams();
            }
            if (pendingDollar[member] < amount) revert InsufficientPending();
            pendingDollar[member] -= amount;
            total += amount;
        }
        totalPendingDollar -= total;
    }

    /// @dev Splits `received` by each member's part of `total`, sets the fee of each share aside and credits the rest.
    function _creditShares(
        address[] calldata members_,
        uint256[] calldata dollarAmounts,
        uint256 received,
        uint256 total
    ) private {
        uint256 fees;
        uint256 credits;
        for (uint256 i; i < members_.length; ++i) {
            address member = members_[i];
            uint256 share = received * dollarAmounts[i] / total;
            uint256 fee = share * feeBps / BPS;
            uint256 credited = share - fee;
            fees += fee;
            credits += credited;
            contributed[member] += credited;
            emit Conversion(member, dollarAmounts[i], share, credited);
        }
        feeOwed += fees;
        totalContributed += credits;
    }

    /// @dev Only the pool, only during `convert` and only once, can collect the swap's dollars, and never more than
    ///      the total being converted.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external override {
        uint256 limit = _swapDollarLimit;
        if (msg.sender != address(pool) || limit == 0) revert OnlyPool();
        int256 owed = _dollarIsToken0 ? amount0Delta : amount1Delta;
        if (owed <= 0 || uint256(owed) > limit) revert SwapOverpayment();
        _swapDollarLimit = 0;
        dollar.safeTransfer(address(pool), uint256(owed));
    }

    // ---------------------------------------------------------------- Reimbursement (agent)
    /// @notice Pays a member back for the expense the group agreed on, without votes, up to `weeklyCap` per week. It is
    ///         paid from what the fund can pay (`availableCurrency`), never from the fee set aside.
    /// @param ref Hash of the expense entered in the web app (the timeline uses it to link to the expense).
    function reimburseAgreedExpense(address member, uint256 amount, bytes32 ref)
        external
        onlyAgent
        whenOpen
        nonReentrant
    {
        if (!isMember[member]) revert RecipientNotMember();
        if (amount == 0) revert ZeroAmount();
        uint256 week = currentWeek();
        uint256 spent = spentInWeek[week] + amount;
        if (spent > weeklyCap) revert WeeklyCapExceeded();
        spentInWeek[week] = spent;
        _payCurrency(member, amount);
        emit Reimbursement(member, amount, ref, week);
    }

    /// @dev Pays `amount` of the currency out of `availableCurrency()`, so the fee set aside is never touched.
    function _payCurrency(address to, uint256 amount) internal {
        if (availableCurrency() < amount) revert InsufficientBalance();
        currency.safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------- Proposals and votes
    /// @notice A member or the agent proposes `action`; a member proposer votes for it too. Each proposer may make at
    ///         most `MAX_PROPOSALS_PER_WEEK` proposals per week (the count starts over each week, the agent's too), and
    ///         `note` is at most `MAX_NOTE_BYTES` bytes.
    function propose(Action action, address a, address b, uint256 amount, string calldata note)
        external
        whenOpen
        returns (uint256 id)
    {
        bool member = isMember[msg.sender];
        if (!member && msg.sender != agent) revert OnlyMemberOrAgent();
        if (bytes(note).length > MAX_NOTE_BYTES) revert NoteTooLong();
        if (++proposalsInWeek[currentWeek()][msg.sender] > MAX_PROPOSALS_PER_WEEK) revert TooManyProposals();
        id = _proposals.length;
        _proposals.push(
            Proposal({
                action: action,
                a: a,
                b: b,
                amount: amount,
                deadline: uint64(block.timestamp + PROPOSAL_DURATION),
                executed: false,
                proposer: msg.sender,
                note: note
            })
        );
        emit ProposalCreated(id, action, a, b, amount, msg.sender, note);
        if (member) _vote(id);
    }

    function vote(uint256 id) external onlyMember whenOpen {
        _activeProposal(id);
        _vote(id);
    }

    function execute(uint256 id) external whenOpen nonReentrant {
        Proposal storage p = _activeProposal(id);
        if (voteCount(id) < votesRequired) revert NotEnoughVotes();
        p.executed = true;
        _apply(p);
        emit ProposalExecuted(id);
    }

    /// @notice Votes in favor, counting only current members.
    function voteCount(uint256 id) public view returns (uint256 n) {
        uint256 count = _members.length;
        for (uint256 i; i < count; ++i) {
            if (hasVoted[id][_members[i]]) ++n;
        }
    }

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        if (id >= _proposals.length) revert ProposalNotFound();
        return _proposals[id];
    }

    function _vote(uint256 id) internal {
        if (hasVoted[id][msg.sender]) revert AlreadyVoted();
        hasVoted[id][msg.sender] = true;
        emit VoteCast(id, msg.sender);
    }

    function _activeProposal(uint256 id) internal view returns (Proposal storage p) {
        if (id >= _proposals.length) revert ProposalNotFound();
        p = _proposals[id];
        if (p.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp > p.deadline) revert ProposalExpired();
    }

    function _apply(Proposal storage p) internal {
        Action action = p.action;
        if (action == Action.Pay) {
            if (!isMember[p.a]) revert RecipientNotMember();
            if (p.amount == 0) revert ZeroAmount();
            _payCurrency(p.a, p.amount);
            emit Payment(p.a, p.amount);
        } else if (action == Action.AddMember) {
            if (p.a == address(0) || p.a == agent || isMember[p.a] || _members.length >= MAX_MEMBERS) {
                revert InvalidParams();
            }
            isMember[p.a] = true;
            _members.push(p.a);
            emit MemberAdded(p.a);
        } else if (action == Action.RemoveMember) {
            if (!isMember[p.a] || _members.length - 1 <= votesRequired) revert InvalidParams();
            uint256 c = _shareOf(p.a);
            uint256 d = pendingDollar[p.a];
            totalContributed -= contributed[p.a];
            contributed[p.a] = 0;
            totalPendingDollar -= d;
            pendingDollar[p.a] = 0;
            _removeMember(p.a);
            if (c > 0) currency.safeTransfer(p.a, c);
            if (d > 0) dollar.safeTransfer(p.a, d);
            emit MemberRemoved(p.a, c, d);
        } else if (action == Action.ReplaceMember) {
            if (!isMember[p.a] || p.b == address(0) || p.b == agent || isMember[p.b]) {
                revert InvalidParams();
            }
            uint256 n = _members.length;
            for (uint256 i; i < n; ++i) {
                if (_members[i] == p.a) {
                    _members[i] = p.b;
                    break;
                }
            }
            isMember[p.a] = false;
            isMember[p.b] = true;
            contributed[p.b] = contributed[p.a];
            contributed[p.a] = 0;
            pendingDollar[p.b] = pendingDollar[p.a];
            pendingDollar[p.a] = 0;
            emit MemberReplaced(p.a, p.b);
        } else if (action == Action.SetWeeklyCap) {
            if (p.amount > balanceCap) revert InvalidParams();
            weeklyCap = p.amount;
            emit WeeklyCapChanged(p.amount);
        } else if (action == Action.SetVotesRequired) {
            if (p.amount < MIN_VOTES || p.amount >= _members.length) revert InvalidParams();
            votesRequired = uint8(p.amount);
            emit VotesRequiredChanged(uint8(p.amount));
        } else if (action == Action.SetAgent) {
            if (p.a == address(0) || p.a == address(this) || isMember[p.a]) revert InvalidParams();
            agent = p.a;
            emit AgentChanged(p.a);
        } else if (action == Action.GiveBack) {
            _giveBack(p.a, p.amount);
        } else {
            _close();
        }
    }

    /// @dev Pays a member back part of what they contributed, and takes it off what they contributed.
    function _giveBack(address member, uint256 amount) internal {
        if (!isMember[member]) revert RecipientNotMember();
        if (amount == 0) revert ZeroAmount();
        if (amount > contributed[member]) revert GiveBackTooLarge();
        contributed[member] -= amount;
        totalContributed -= amount;
        _payCurrency(member, amount);
        emit ContributionGivenBack(member, amount);
    }

    /// @dev `m`'s proportional share of what the fund can pay, by contribution. If no one has contributed, `m` gets
    ///      nothing.
    function _shareOf(address m) internal view returns (uint256) {
        if (totalContributed == 0) return 0;
        return availableCurrency() * contributed[m] / totalContributed;
    }

    function _removeMember(address m) internal {
        uint256 n = _members.length;
        for (uint256 i; i < n; ++i) {
            if (_members[i] == m) {
                _members[i] = _members[n - 1];
                _members.pop();
                break;
            }
        }
        isMember[m] = false;
    }

    /// @dev Closes the fund and splits what it holds. Emits the balances read before the split.
    function _close() internal {
        closed = true;
        (uint256 bc, uint256 bd) = _split();
        emit FundClosed(bc, bd);
    }

    /// @dev Pays each member their own pending dollars, then splits what the fund can pay in the currency and what is
    ///      left of the dollar among the members in proportion to contributions (equally if no one contributed). The
    ///      fee set aside is left in the contract for `payFee`. Returns what the fund could pay in the currency and
    ///      its dollar balance, both read before the split. Rounding dust stays in the contract.
    function _split() internal returns (uint256 bc, uint256 bd) {
        bc = availableCurrency();
        uint256 n = _members.length;
        bool hasDollar = address(dollar) != address(0);
        uint256 leftDollar = 0;
        if (hasDollar) {
            bd = dollar.balanceOf(address(this));
            for (uint256 i; i < n; ++i) {
                address m = _members[i];
                uint256 pending = pendingDollar[m];
                if (pending > 0) {
                    pendingDollar[m] = 0;
                    dollar.safeTransfer(m, pending);
                }
            }
            totalPendingDollar = 0;
            leftDollar = dollar.balanceOf(address(this));
        }
        uint256 total = totalContributed;
        for (uint256 i; i < n; ++i) {
            address m = _members[i];
            uint256 c = total == 0 ? bc / n : bc * contributed[m] / total;
            uint256 d = total == 0 ? leftDollar / n : leftDollar * contributed[m] / total;
            if (c > 0) currency.safeTransfer(m, c);
            if (d > 0) dollar.safeTransfer(m, d);
        }
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

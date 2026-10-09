// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IUniswapV3SwapCallback} from "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import {TickMath} from "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import {OracleLibrary} from "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";

/// @title TesorerIA fund
/// @notice A group's shared fund in wARS. No one in the group holds the money: the agent can only convert USDT
///         to wARS and reimburse the agreed expense up to a weekly cap, always to members. Everything else is voted on.
contract Fund is ReentrancyGuardTransient, IUniswapV3SwapCallback {
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

    // ---------------------------------------------------------------- Types
    struct Params {
        string name;
        address[] members;
        uint8 votesRequired;
        address agent;
        string agreedExpense;
        uint256 weeklyCap;
        uint256 balanceCap;
    }

    enum Action {
        Pay,
        AddMember,
        RemoveMember,
        ReplaceMember,
        SetWeeklyCap,
        SetVotesRequired,
        SetAgent,
        Close
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

    // ---------------------------------------------------------------- Events
    event Contribution(address indexed member, address indexed token, uint256 amount, uint256 creditedWars);
    event Conversion(uint256 usdtIn, uint256 warsOut);
    event Reimbursement(address indexed member, uint256 amount, bytes32 ref, uint256 week);
    event ProposalCreated(
        uint256 indexed id, Action action, address a, address b, uint256 amount, address indexed proposer, string note
    );
    event VoteCast(uint256 indexed id, address indexed member);
    event ProposalExecuted(uint256 indexed id);
    event Payment(address indexed member, uint256 amount);
    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member, uint256 warsReturned, uint256 usdtReturned);
    event MemberReplaced(address indexed oldMember, address indexed newMember);
    event WeeklyCapChanged(uint256 cap);
    event VotesRequiredChanged(uint8 votes);
    event AgentChanged(address indexed agent);
    event FundClosed(uint256 warsBalance, uint256 usdtBalance);

    // ---------------------------------------------------------------- State
    IERC20 public immutable wars;
    IERC20 public immutable usdt;
    IUniswapV3Pool public immutable pool;
    uint256 public immutable startTime;
    uint256 public immutable balanceCap;
    bool private immutable _usdtIsToken0;

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
    mapping(uint256 => uint256) public spentInWeek;

    Proposal[] private _proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    /// @dev USDT the pool may still collect in the current conversion; zero outside `convert`.
    uint256 private transient _swapUsdtLimit;

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
    constructor(IERC20 wars_, IERC20 usdt_, IUniswapV3Pool pool_, Params memory p) {
        address t0 = pool_.token0();
        address t1 = pool_.token1();
        bool tokensOk = (t0 == address(wars_) && t1 == address(usdt_)) || (t0 == address(usdt_) && t1 == address(wars_));
        uint256 n = p.members.length;
        if (
            !tokensOk || n < MIN_MEMBERS || n > MAX_MEMBERS || p.votesRequired < MIN_VOTES
                || p.votesRequired >= n || p.balanceCap == 0
        ) revert InvalidParams();
        for (uint256 i; i < n; ++i) {
            address m = p.members[i];
            if (m == address(0) || m == p.agent || isMember[m]) revert InvalidParams();
            isMember[m] = true;
            _members.push(m);
        }
        wars = wars_;
        usdt = usdt_;
        pool = pool_;
        _usdtIsToken0 = t0 == address(usdt_);
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

    /// @notice How many wARS `usdtAmount` is worth at the pool's 30-minute TWAP.
    function quoteUsdtInWars(uint256 usdtAmount) public view returns (uint256) {
        if (usdtAmount == 0) return 0;
        if (usdtAmount > type(uint128).max) revert InvalidParams();
        return OracleLibrary.getQuoteAtTick(_averageTick(), uint128(usdtAmount), address(usdt), address(wars));
    }

    /// @notice The fund's total balance in wARS (the USDT valued at the TWAP).
    function balanceInWars() public view returns (uint256) {
        return wars.balanceOf(address(this)) + quoteUsdtInWars(usdt.balanceOf(address(this)));
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
    function contributeWars(uint256 amount) external onlyMember whenOpen nonReentrant {
        uint256 received = _pullTokens(wars, amount);
        _credit(msg.sender, address(wars), received, received);
    }

    function contributeUsdt(uint256 amount) external onlyMember whenOpen nonReentrant {
        uint256 received = _pullTokens(usdt, amount);
        _credit(msg.sender, address(usdt), received, quoteUsdtInWars(received));
    }

    /// @dev Measures what arrived by balance difference, within the call (the spec's CIP-64 rule).
    function _pullTokens(IERC20 token, uint256 amount) internal returns (uint256) {
        if (amount == 0) revert ZeroAmount();
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        return token.balanceOf(address(this)) - balanceBefore;
    }

    function _credit(address member, address token, uint256 received, uint256 inWars) internal {
        if (balanceInWars() > balanceCap) revert BalanceCapExceeded();
        contributed[member] += inWars;
        totalContributed += inWars;
        emit Contribution(member, token, received, inWars);
    }

    // ---------------------------------------------------------------- Conversion (agent)
    /// @notice Swaps `usdtAmount` of the fund's USDT for wARS in the pool. `minWarsOut` can't be more than 2% below
    ///         the TWAP quote, and what arrives can't be less than `minWarsOut`.
    function convert(uint256 usdtAmount, uint256 minWarsOut)
        external
        onlyAgent
        whenOpen
        nonReentrant
        returns (uint256 received)
    {
        if (usdtAmount == 0) revert ZeroAmount();
        if (usdt.balanceOf(address(this)) < usdtAmount) revert InsufficientBalance();
        uint256 expected = quoteUsdtInWars(usdtAmount);
        if (minWarsOut < expected * (BPS - MAX_DEVIATION_BPS) / BPS) revert MinOutTooLow();

        bool zeroForOne = _usdtIsToken0;
        uint256 balanceBefore = wars.balanceOf(address(this));
        _swapUsdtLimit = usdtAmount;
        pool.swap(
            address(this),
            zeroForOne,
            int256(usdtAmount),
            zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1,
            ""
        );
        _swapUsdtLimit = 0;
        received = wars.balanceOf(address(this)) - balanceBefore;
        if (received < minWarsOut) revert InsufficientOutput();
        emit Conversion(usdtAmount, received);
    }

    /// @dev Only the pool, only during `convert` and only once, can collect the swap's USDT, and never more than
    ///      the `usdtAmount` being converted.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external override {
        uint256 limit = _swapUsdtLimit;
        if (msg.sender != address(pool) || limit == 0) revert OnlyPool();
        int256 owed = _usdtIsToken0 ? amount0Delta : amount1Delta;
        if (owed <= 0 || uint256(owed) > limit) revert SwapOverpayment();
        _swapUsdtLimit = 0;
        usdt.safeTransfer(address(pool), uint256(owed));
    }

    // ---------------------------------------------------------------- Reimbursement (agent)
    /// @notice Pays a member back for the expense the group agreed on, without votes, up to `weeklyCap` per week.
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
        _payWars(member, amount);
        emit Reimbursement(member, amount, ref, week);
    }

    function _payWars(address to, uint256 amount) internal {
        if (wars.balanceOf(address(this)) < amount) revert InsufficientBalance();
        wars.safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------- Proposals and votes
    function propose(Action action, address a, address b, uint256 amount, string calldata note)
        external
        whenOpen
        returns (uint256 id)
    {
        bool member = isMember[msg.sender];
        if (!member && msg.sender != agent) revert OnlyMemberOrAgent();
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
            _payWars(p.a, p.amount);
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
            (uint256 w, uint256 u) = _shareOf(p.a);
            totalContributed -= contributed[p.a];
            contributed[p.a] = 0;
            _removeMember(p.a);
            if (w > 0) wars.safeTransfer(p.a, w);
            if (u > 0) usdt.safeTransfer(p.a, u);
            emit MemberRemoved(p.a, w, u);
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
            emit MemberReplaced(p.a, p.b);
        } else if (action == Action.SetWeeklyCap) {
            weeklyCap = p.amount;
            emit WeeklyCapChanged(p.amount);
        } else if (action == Action.SetVotesRequired) {
            if (p.amount < MIN_VOTES || p.amount >= _members.length) revert InvalidParams();
            votesRequired = uint8(p.amount);
            emit VotesRequiredChanged(uint8(p.amount));
        } else if (action == Action.SetAgent) {
            if (isMember[p.a]) revert InvalidParams();
            agent = p.a;
            emit AgentChanged(p.a);
        } else {
            _close();
        }
    }

    /// @dev `m`'s proportional share of the balances, by contribution. If no one has contributed, `m` gets nothing.
    function _shareOf(address m) internal view returns (uint256 w, uint256 u) {
        if (totalContributed == 0) return (0, 0);
        w = wars.balanceOf(address(this)) * contributed[m] / totalContributed;
        u = usdt.balanceOf(address(this)) * contributed[m] / totalContributed;
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

    /// @dev Splits wARS and USDT in proportion to contributions (equally if no one contributed) and closes the fund.
    ///      Emits the balances read before the split. Rounding dust (under 1 wei per member) stays in the contract.
    function _close() internal {
        closed = true;
        uint256 bw = wars.balanceOf(address(this));
        uint256 bu = usdt.balanceOf(address(this));
        uint256 n = _members.length;
        uint256 total = totalContributed;
        for (uint256 i; i < n; ++i) {
            address m = _members[i];
            uint256 w = total == 0 ? bw / n : bw * contributed[m] / total;
            uint256 u = total == 0 ? bu / n : bu * contributed[m] / total;
            if (w > 0) wars.safeTransfer(m, w);
            if (u > 0) usdt.safeTransfer(m, u);
        }
        emit FundClosed(bw, bu);
    }
}

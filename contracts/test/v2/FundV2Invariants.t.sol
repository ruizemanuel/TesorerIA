// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BaseFundV2Test} from "./BaseV2.t.sol";
import {FundV2} from "../../src/FundV2.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPool} from "../mocks/MockPool.sol";

/// Runs, in random order, contributions in the currency and the dollar, conversions by the agent, dollars sent straight
/// to the fund, fee payments, reimbursements, complete governance actions (propose, vote up to N and execute) and the
/// passing of time. Each call is one coherent action: if it wouldn't be valid in the current state, it skips it instead
/// of reverting. It never proposes `Close`, so the fund stays open for the whole run.
contract FundV2Handler is CommonBase, StdCheats, StdUtils {
    FundV2 public immutable fund;
    MockERC20 public immutable currency;
    MockERC20 public immutable dollar;
    MockPool public immutable pool;
    /// Every address the handler can touch: the initial members and the candidates to join.
    address[] internal _actors;

    /// What `payFee` has sent to the fee recipient, the only way the currency reaches it.
    uint256 public feesPaid;

    constructor(FundV2 fund_, MockERC20 currency_, MockERC20 dollar_, MockPool pool_, address[] memory actors_) {
        fund = fund_;
        currency = currency_;
        dollar = dollar_;
        pool = pool_;
        _actors = actors_;
    }

    function actors() external view returns (address[] memory) {
        return _actors;
    }

    // ---------------------------------------------------------------- Money in
    function contribute(uint256 seed, uint256 amount) external {
        uint256 room = _room();
        if (room == 0) return;
        amount = _amount(amount, room);
        address m = _member(seed);
        currency.mint(m, amount);
        vm.startPrank(m);
        currency.approve(address(fund), amount);
        fund.contribute(amount);
        vm.stopPrank();
    }

    function contributeDollar(uint256 seed, uint256 amount) external {
        uint256 room = _room();
        if (room == 0) return;
        amount = _amount(amount, _dollarsWorth(room));
        // The same cap check the fund makes, so a quote that rounds up past the room doesn't revert.
        uint256 held = dollar.balanceOf(address(fund)) + amount;
        if (fund.availableCurrency() + fund.quoteDollar(held) > fund.balanceCap()) return;
        address m = _member(seed);
        dollar.mint(m, amount);
        vm.startPrank(m);
        dollar.approve(address(fund), amount);
        fund.contributeDollar(amount);
        vm.stopPrank();
    }

    /// Dollars no member contributed: sent to the fund address directly, they belong to no one's pending.
    function sendStrayDollar(uint256 amount) external {
        uint256 room = _room();
        if (room == 0) return;
        dollar.mint(address(fund), _amount(amount, _dollarsWorth(room)));
    }

    // ---------------------------------------------------------------- Agent
    /// The agent converts some members' pending dollars (all of a member's, or part of it) at a pool that delivers
    /// between the TWAP less the fund's 2 % limit and the TWAP, with the minimum set at that limit.
    function convert(uint256 seed, uint256 amountSeed, uint256 quality) external {
        address[] memory list = fund.members();
        address[] memory picked = new address[](list.length);
        uint256[] memory amounts = new uint256[](list.length);
        uint256 count;
        uint256 total;
        for (uint256 k; k < list.length; ++k) {
            uint256 pending = fund.pendingDollar(list[k]);
            if (pending == 0 || (seed >> k) & 1 == 0) continue;
            uint256 draw = uint256(keccak256(abi.encode(amountSeed, k)));
            uint256 amount = draw % 3 == 0 ? pending : _amount(draw, pending);
            picked[count] = list[k];
            amounts[count] = amount;
            total += amount;
            ++count;
        }
        if (count == 0) return;
        address[] memory pickedMembers = new address[](count);
        uint256[] memory pickedAmounts = new uint256[](count);
        for (uint256 k; k < count; ++k) {
            pickedMembers[k] = picked[k];
            pickedAmounts[k] = amounts[k];
        }

        uint256 bps = fund.BPS();
        pool.setQuality(bound(quality, bps - fund.MAX_DEVIATION_BPS(), bps));
        uint256 minOut = fund.quoteDollar(total) * (bps - fund.MAX_DEVIATION_BPS()) / bps;
        address agent = fund.agent();
        vm.prank(agent);
        fund.convert(pickedMembers, pickedAmounts, minOut);
    }

    function reimburse(uint256 seed, uint256 amount, bytes32 ref) external {
        uint256 spent = fund.spentInWeek(fund.currentWeek());
        uint256 cap = fund.weeklyCap();
        uint256 left = spent >= cap ? 0 : cap - spent;
        uint256 max = Math.min(left, fund.availableCurrency());
        if (max == 0) return;
        address m = _member(seed);
        amount = _amount(amount, max);
        address agent = fund.agent();
        vm.prank(agent);
        fund.reimburseAgreedExpense(m, amount, ref);
    }

    // ---------------------------------------------------------------- Fee
    function payFee() external {
        uint256 owed = fund.feeOwed();
        if (owed == 0) return;
        fund.payFee();
        feesPaid += owed;
    }

    // ---------------------------------------------------------------- Governance
    function pay(uint256 seed, uint256 amount) external {
        uint256 available = fund.availableCurrency();
        if (available == 0) return;
        _proposeAndPass(FundV2.Action.Pay, _member(seed), address(0), _amount(amount, available), seed);
    }

    function giveBack(uint256 seed, uint256 amount) external {
        uint256 available = fund.availableCurrency();
        address[] memory list = fund.members();
        uint256 first = seed % list.length;
        for (uint256 k; k < list.length; ++k) {
            address m = list[(first + k) % list.length];
            uint256 c = fund.contributed(m);
            if (c == 0) continue;
            if (available == 0) return;
            _proposeAndPass(FundV2.Action.GiveBack, m, address(0), _amount(amount, Math.min(c, available)), seed);
            return;
        }
    }

    function addMember(uint256 seed) external {
        if (fund.members().length >= fund.MAX_MEMBERS()) return;
        (address x, bool found) = _nonMember(seed);
        if (!found) return;
        _proposeAndPass(FundV2.Action.AddMember, x, address(0), 0, seed);
    }

    function removeMember(uint256 seed) external {
        if (fund.members().length - 1 <= fund.votesRequired()) return;
        _proposeAndPass(FundV2.Action.RemoveMember, _member(seed), address(0), 0, seed);
    }

    function replaceMember(uint256 oldSeed, uint256 newSeed) external {
        (address newMember, bool found) = _nonMember(newSeed);
        if (!found) return;
        _proposeAndPass(FundV2.Action.ReplaceMember, _member(oldSeed), newMember, 0, oldSeed);
    }

    // ---------------------------------------------------------------- Payments the fund must refuse
    // These try to pay out more than `availableCurrency()` (but no more than the fund's whole balance, fee set aside
    // included). The fund refuses each with `InsufficientBalance`, which they expect; a refusal for any other reason
    // fails the run, and a payment that goes through breaks `invariant_feeOwedBackedByCurrency`.

    /// A passed vote to pay a member more than the fund can pay.
    function payBeyondAvailable(uint256 seed, uint256 extra) external {
        uint256 owed = fund.feeOwed();
        if (owed == 0) return;
        uint256 amount = fund.availableCurrency() + bound(extra, 1, owed);
        (uint256 id, bool proposed) = _proposeAndVote(FundV2.Action.Pay, _member(seed), address(0), amount, seed);
        if (!proposed) return;
        try fund.execute(id) {}
        catch (bytes memory reason) {
            _requireRefusedForBalance(reason);
        }
    }

    /// A passed vote to give a member back more than the fund can pay, from a member who contributed that much.
    function giveBackBeyondAvailable(uint256 seed, uint256 extra) external {
        uint256 owed = fund.feeOwed();
        if (owed == 0) return;
        uint256 available = fund.availableCurrency();
        (address m, uint256 c) = _memberWhoContributedMoreThan(seed, available);
        if (m == address(0)) return;
        uint256 amount = available + bound(extra, 1, Math.min(owed, c - available));
        (uint256 id, bool proposed) = _proposeAndVote(FundV2.Action.GiveBack, m, address(0), amount, seed);
        if (!proposed) return;
        try fund.execute(id) {}
        catch (bytes memory reason) {
            _requireRefusedForBalance(reason);
        }
    }

    /// The agent reimburses a member more than the fund can pay, within the weekly cap.
    function reimburseBeyondAvailable(uint256 seed, uint256 extra, bytes32 ref) external {
        uint256 owed = fund.feeOwed();
        if (owed == 0) return;
        uint256 amount = fund.availableCurrency() + bound(extra, 1, owed);
        uint256 spent = fund.spentInWeek(fund.currentWeek());
        // The weekly cap would refuse it first, and that is not what this checks.
        if (spent + amount > fund.weeklyCap()) return;
        address m = _member(seed);
        address agent = fund.agent();
        vm.prank(agent);
        try fund.reimburseAgreedExpense(m, amount, ref) {}
        catch (bytes memory reason) {
            _requireRefusedForBalance(reason);
        }
    }

    // ---------------------------------------------------------------- Time
    /// Moves on up to ten days, so the weekly cap and the weekly proposal limit start over now and then.
    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 10 days));
    }

    // ---------------------------------------------------------------- Helpers
    /// Proposes and votes `action` through, then anyone executes it. If every member is out of proposals this week, it
    /// does nothing.
    function _proposeAndPass(FundV2.Action action, address a, address b, uint256 amount, uint256 seed) internal {
        (uint256 id, bool proposed) = _proposeAndVote(action, a, b, amount, seed);
        if (proposed) fund.execute(id);
    }

    /// A member with proposals left this week (the limit is per proposer) proposes, and so votes, and the next ones
    /// vote until N is reached.
    function _proposeAndVote(FundV2.Action action, address a, address b, uint256 amount, uint256 seed)
        internal
        returns (uint256 id, bool proposed)
    {
        address[] memory list = fund.members();
        uint256 n = list.length;
        uint256 week = fund.currentWeek();
        uint256 first = uint256(keccak256(abi.encode(seed, action))) % n;
        uint256 start = n;
        for (uint256 k; k < n; ++k) {
            if (fund.proposalsInWeek(week, list[(first + k) % n]) < fund.MAX_PROPOSALS_PER_WEEK()) {
                start = (first + k) % n;
                break;
            }
        }
        if (start == n) return (0, false);
        vm.prank(list[start]);
        id = fund.propose(action, a, b, amount, "invariant");
        for (uint256 k = 1; k < n && fund.voteCount(id) < fund.votesRequired(); ++k) {
            vm.prank(list[(start + k) % n]);
            fund.vote(id);
        }
        return (id, true);
    }

    /// The fund must refuse a payment of more than it can pay for lack of balance, and for no other reason. If it let
    /// one through, it would dip into the fee set aside, which `invariant_feeOwedBackedByCurrency` catches.
    function _requireRefusedForBalance(bytes memory reason) internal pure {
        require(bytes4(reason) == FundV2.InsufficientBalance.selector, "refused for another reason");
    }

    /// The first member, starting from a random one, whose contributions are more than `amount`; zero if there is none.
    function _memberWhoContributedMoreThan(uint256 seed, uint256 amount) internal view returns (address, uint256) {
        address[] memory list = fund.members();
        uint256 first = seed % list.length;
        for (uint256 k; k < list.length; ++k) {
            address m = list[(first + k) % list.length];
            uint256 c = fund.contributed(m);
            if (c > amount) return (m, c);
        }
        return (address(0), 0);
    }

    function _member(uint256 seed) internal view returns (address) {
        address[] memory list = fund.members();
        return list[seed % list.length];
    }

    /// The first actor who is not a member, starting from a random one.
    function _nonMember(uint256 seed) internal view returns (address, bool) {
        uint256 n = _actors.length;
        uint256 start = seed % n;
        for (uint256 k; k < n; ++k) {
            address x = _actors[(start + k) % n];
            if (!fund.isMember(x)) return (x, true);
        }
        return (address(0), false);
    }

    /// How much the fund can still take in before it passes its balance cap, in the currency.
    function _room() internal view returns (uint256) {
        uint256 balance = fund.balanceInCurrency();
        uint256 cap = fund.balanceCap();
        return balance >= cap ? 0 : cap - balance;
    }

    /// About how many dollars (in the dollar's smallest unit) are worth `value` of the currency, rounded up to at least 1.
    function _dollarsWorth(uint256 value) internal view returns (uint256) {
        uint256 oneDollar = 10 ** dollar.decimals();
        return Math.max(1, value * oneDollar / fund.quoteDollar(oneDollar));
    }

    /// An amount in [1, max] over many orders of magnitude, so dust (where rounding bites) comes up as often as big
    /// amounts do.
    function _amount(uint256 raw, uint256 max) internal pure returns (uint256) {
        uint256 shift = uint256(keccak256(abi.encode(raw))) % (Math.log2(max) + 1);
        uint256 amount = bound(raw, 1, max) >> shift;
        return amount == 0 ? 1 : amount;
    }
}

/// With contributions in two tokens, conversions, member changes, payments and fee payments in any order: what members
/// are credited and have pending adds up, the dollars and the currency the fund holds cover what it owes, and the fee
/// recipient gets nothing but the fee.
contract FundV2InvariantsTest is BaseFundV2Test {
    FundV2Handler internal handler;

    function setUp() public override {
        super.setUp();
        address[] memory actors = new address[](12);
        for (uint256 i; i < 5; ++i) {
            actors[i] = members[i];
        }
        for (uint256 i = 5; i < 12; ++i) {
            actors[i] = makeAddr(string.concat("candidate", vm.toString(i)));
        }
        handler = new FundV2Handler(fund, currency, dollar, pool, actors);

        bytes4[] memory selectors = new bytes4[](15);
        selectors[0] = FundV2Handler.contribute.selector;
        selectors[1] = FundV2Handler.contributeDollar.selector;
        selectors[2] = FundV2Handler.sendStrayDollar.selector;
        selectors[3] = FundV2Handler.convert.selector;
        selectors[4] = FundV2Handler.reimburse.selector;
        selectors[5] = FundV2Handler.payFee.selector;
        selectors[6] = FundV2Handler.pay.selector;
        selectors[7] = FundV2Handler.giveBack.selector;
        selectors[8] = FundV2Handler.addMember.selector;
        selectors[9] = FundV2Handler.removeMember.selector;
        selectors[10] = FundV2Handler.replaceMember.selector;
        selectors[11] = FundV2Handler.payBeyondAvailable.selector;
        selectors[12] = FundV2Handler.giveBackBeyondAvailable.selector;
        selectors[13] = FundV2Handler.reimburseBeyondAvailable.selector;
        selectors[14] = FundV2Handler.warp.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// Everyone's credited contributions are what the fund counts as contributed. A member who left took theirs with
    /// them, and one who was replaced passed theirs on.
    function invariant_contributedSumsToTotal() public view {
        address[] memory list = fund.members();
        uint256 sum;
        for (uint256 i; i < list.length; ++i) {
            sum += fund.contributed(list[i]);
        }
        assertEq(sum, fund.totalContributed());
    }

    /// The pending dollars of the current members are all the pending dollars there are: a member who left had theirs
    /// returned and cleared, and one who was replaced passed theirs on.
    function invariant_pendingSumsToTotal() public view {
        address[] memory list = fund.members();
        uint256 sum;
        for (uint256 i; i < list.length; ++i) {
            sum += fund.pendingDollar(list[i]);
        }
        assertEq(sum, fund.totalPendingDollar());
    }

    /// Every pending dollar is in the fund, whether or not anyone has sent it extra dollars.
    function invariant_pendingBackedByDollars() public view {
        assertLe(fund.totalPendingDollar(), dollar.balanceOf(address(fund)));
    }

    /// The fee set aside is in the fund's currency balance, and no payment, share or reimbursement reaches it.
    function invariant_feeOwedBackedByCurrency() public view {
        assertGe(currency.balanceOf(address(fund)), fund.feeOwed());
    }

    /// The fee recipient has received what `payFee` sent, and nothing else.
    function invariant_recipientOnlyGetsFees() public view {
        assertEq(currency.balanceOf(feeRecipient), handler.feesPaid());
    }
}

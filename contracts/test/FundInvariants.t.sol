// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {BaseFundTest} from "./Base.t.sol";
import {Fund} from "../src/Fund.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// Runs, in random order, wARS contributions and complete governance actions (propose, vote up to N and execute).
/// Each call is one coherent action: if it wouldn't be valid in the current state, it skips it instead of reverting.
contract FundHandler is CommonBase, StdCheats, StdUtils {
    Fund public immutable fund;
    MockERC20 public immutable wars;
    /// Every address the handler can touch: the initial members and the candidates to join.
    address[] internal _actors;

    constructor(Fund fund_, MockERC20 wars_, address[] memory actors_) {
        fund = fund_;
        wars = wars_;
        _actors = actors_;
    }

    function actors() external view returns (address[] memory) {
        return _actors;
    }

    function contribute(uint256 seed, uint256 amount) external {
        uint256 balance = fund.balanceInWars();
        uint256 cap = fund.balanceCap();
        if (balance >= cap) return;
        amount = bound(amount, 1, cap - balance);
        address[] memory list = fund.members();
        address m = list[seed % list.length];
        wars.mint(m, amount);
        vm.startPrank(m);
        wars.approve(address(fund), amount);
        fund.contributeWars(amount);
        vm.stopPrank();
    }

    function addMember(uint256 seed) external {
        if (fund.members().length >= fund.MAX_MEMBERS()) return;
        (address x, bool found) = _nonMember(seed);
        if (!found) return;
        _approveAndExecute(Fund.Action.AddMember, x, address(0), 0, seed);
    }

    function removeMember(uint256 seed) external {
        address[] memory list = fund.members();
        if (list.length - 1 <= fund.votesRequired()) return;
        _approveAndExecute(Fund.Action.RemoveMember, list[seed % list.length], address(0), 0, seed);
    }

    function replaceMember(uint256 oldSeed, uint256 newSeed) external {
        (address newMember, bool found) = _nonMember(newSeed);
        if (!found) return;
        address[] memory list = fund.members();
        _approveAndExecute(Fund.Action.ReplaceMember, list[oldSeed % list.length], newMember, 0, oldSeed);
    }

    function setVotesRequired(uint256 votes, uint256 seed) external {
        votes = bound(votes, fund.MIN_VOTES(), fund.members().length - 1);
        _approveAndExecute(Fund.Action.SetVotesRequired, address(0), address(0), votes, seed);
    }

    /// A random member proposes (and so votes), the next ones vote until N is reached, and anyone executes.
    function _approveAndExecute(Fund.Action action, address a, address b, uint256 amount, uint256 seed) internal {
        address[] memory list = fund.members();
        uint256 n = list.length;
        uint256 first = uint256(keccak256(abi.encode(seed, action))) % n;
        vm.prank(list[first]);
        uint256 id = fund.propose(action, a, b, amount, "invariant");
        for (uint256 k = 1; k < n && fund.voteCount(id) < fund.votesRequired(); ++k) {
            vm.prank(list[(first + k) % n]);
            fund.vote(id);
        }
        fund.execute(id);
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
}

/// With member changes, N changes and contributions in any order, the member list (the one that counts votes and
/// splits the close) matches `isMember`, and the contributions add up to `totalContributed`.
contract FundInvariantsTest is BaseFundTest {
    FundHandler internal handler;

    function setUp() public override {
        super.setUp();
        address[] memory actors = new address[](12);
        for (uint256 i; i < 5; ++i) actors[i] = members[i];
        for (uint256 i = 5; i < 12; ++i) actors[i] = makeAddr(string.concat("candidate", vm.toString(i)));
        handler = new FundHandler(fund, wars, actors);

        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = FundHandler.contribute.selector;
        selectors[1] = FundHandler.addMember.selector;
        selectors[2] = FundHandler.removeMember.selector;
        selectors[3] = FundHandler.replaceMember.selector;
        selectors[4] = FundHandler.setVotesRequired.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function _contains(address[] memory list, address x) internal pure returns (bool) {
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == x) return true;
        }
        return false;
    }

    function invariant_votesAndMembersInRange() public view {
        uint256 n = fund.members().length;
        uint256 votes = fund.votesRequired();
        assertGe(votes, 2);
        assertLt(votes, n);
        assertLe(n, 10);
    }

    function invariant_isMemberIfAndOnlyIfInTheList() public view {
        address[] memory list = fund.members();
        address[] memory actors = handler.actors();
        for (uint256 i; i < actors.length; ++i) {
            assertEq(fund.isMember(actors[i]), _contains(list, actors[i]));
        }
        for (uint256 i; i < list.length; ++i) {
            assertTrue(fund.isMember(list[i]));
        }
    }

    function invariant_noDuplicatesInTheList() public view {
        address[] memory list = fund.members();
        for (uint256 i; i < list.length; ++i) {
            for (uint256 j = i + 1; j < list.length; ++j) {
                assertNotEq(list[i], list[j]);
            }
        }
    }

    function invariant_memberContributionsAddUpToTheTotal() public view {
        address[] memory list = fund.members();
        uint256 sum;
        for (uint256 i; i < list.length; ++i) {
            sum += fund.contributed(list[i]);
        }
        assertEq(sum, fund.totalContributed());
    }

    function invariant_nonMembersHaveNoContribution() public view {
        address[] memory actors = handler.actors();
        for (uint256 i; i < actors.length; ++i) {
            if (!fund.isMember(actors[i])) assertEq(fund.contributed(actors[i]), 0);
        }
    }
}

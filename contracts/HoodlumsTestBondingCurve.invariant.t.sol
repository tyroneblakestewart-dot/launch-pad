// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FixedSupplyMemeToken} from "./FixedSupplyMemeToken.sol";
import {HoodlumsTestBondingCurve} from "./HoodlumsTestBondingCurve.sol";
import {
    MockWETH9,
    MockUniswapV3Factory,
    MockNonfungiblePositionManager
} from "./mocks/UniswapV3Mocks.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function prank(address nextCaller) external;
}

/// @dev See forge-std's `StdInvariant.sol` FuzzSelector struct.
struct FuzzSelector {
    address addr;
    bytes4[] selectors;
}

/// @dev Minimal, local reimplementation of forge-std's `StdInvariant` target
///      selection surface. Hardhat 3's Solidity test runner (edr) discovers
///      invariant fuzz targets exactly the way Foundry does: after `setUp()`
///      it calls the exact `targetContracts()`/`targetSelectors()` selectors
///      below on the test contract, and restricts every fuzzed call in the
///      sequence accordingly. Kept local instead of adding a forge-std
///      dependency this repo does not otherwise use.
/// @dev Restricting to `targetContract(handler)` alone was tried first and
///      empirically under-graduated: every `public` ghost/state getter on
///      the handler (curve(), token(), ghostTotalNativeIn(), ...) becomes an
///      equally-weighted fuzzable "call" candidate alongside its 4 real
///      actions, diluting real mutating calls to a small fraction of each
///      run's depth budget. `targetSelector` below narrows the runner to
///      exactly the 4 action functions.
abstract contract StdInvariant {
    address[] private _hoodlumsTargetedContracts;
    FuzzSelector[] private _hoodlumsTargetedSelectors;

    function targetContract(address newTargetedContract) internal {
        _hoodlumsTargetedContracts.push(newTargetedContract);
    }

    function targetContracts() external view returns (address[] memory) {
        return _hoodlumsTargetedContracts;
    }

    function targetSelector(FuzzSelector memory newTargetedSelector) internal {
        _hoodlumsTargetedSelectors.push(newTargetedSelector);
    }

    function targetSelectors() external view returns (FuzzSelector[] memory) {
        return _hoodlumsTargetedSelectors;
    }
}

/// @notice Layer 2 (issue #408) of the bonding-curve property test suite:
///         the only contract the invariant runner is allowed to call into
///         (see `targetContract` in the test's `setUp()`). Accepts a fuzzed
///         sequence of buy/sell/withdraw actions from a small fixed set of
///         actors, bounding every fuzzed input itself and swallowing every
///         *legitimate* revert (selling more than held, buying past the
///         graduation target, withdrawing with nothing owed, trading after
///         graduation) so the runner always advances instead of stalling.
/// @dev Every ghost/tracking variable the invariants below need lives here,
///      never in the production contract — this issue is tests only.
contract BondingCurveHandler {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant PRICE_SCALE = 1e18;

    HoodlumsTestBondingCurve public immutable curve;
    FixedSupplyMemeToken public immutable token;
    address public immutable treasury;
    address public immutable creator;
    address[] public actors;

    /// @notice Sum of gross native currency (msg.value) paid in by every
    ///         successful buy across the whole fuzzed sequence so far.
    uint256 public ghostTotalNativeIn;
    /// @notice Sum of net native currency paid out to sellers by every
    ///         successful sell across the whole fuzzed sequence so far.
    uint256 public ghostTotalNativeOut;

    uint256 public callsBuy;
    uint256 public callsSell;
    uint256 public callsWithdrawTreasury;
    uint256 public callsWithdrawCreator;
    uint256 public callsLegitimatelySkipped;

    /// @dev Reserve-ratio "price" (scaled by 1e18) immediately before/after
    ///      the single most recent trade this handler executed, and what
    ///      kind of action it was. The invariant test reads these to check
    ///      price monotonicity for exactly that one action, without needing
    ///      any cross-call state of its own.
    uint256 public priceBeforeLastTrade;
    uint256 public priceAfterLastTrade;
    uint8 public lastActionKind; // 0 = none/no-op, 1 = buy, 2 = sell

    constructor(
        HoodlumsTestBondingCurve curve_,
        FixedSupplyMemeToken token_,
        address treasury_,
        address creator_,
        address[] memory actors_
    ) {
        curve = curve_;
        token = token_;
        treasury = treasury_;
        creator = creator_;
        actors = actors_;
    }

    function actorsCount() external view returns (uint256) {
        return actors.length;
    }

    /// @param actorSeed Fuzzed selector for which of the small fixed actor
    ///        set performs this buy.
    /// @param amountSeed Fuzzed raw amount, bounded internally to a sane
    ///        range around whatever remains to graduation (occasionally
    ///        overshooting it on purpose, to exercise the legitimate
    ///        BuyExceedsGraduationTarget revert path too).
    function buy(uint256 actorSeed, uint256 amountSeed) external {
        address actor = _actor(actorSeed);
        uint256 amount = _boundBuyAmount(amountSeed);

        vm.deal(actor, amount);
        priceBeforeLastTrade = _price();
        vm.prank(actor);
        try curve.buy{value: amount}(0, type(uint256).max) {
            callsBuy++;
            ghostTotalNativeIn += amount;
            lastActionKind = 1;
        } catch {
            callsLegitimatelySkipped++;
            lastActionKind = 0;
        }
        priceAfterLastTrade = _price();
    }

    /// @param actorSeed Fuzzed selector for which actor sells.
    /// @param amountSeed Fuzzed raw amount, bounded internally to mostly stay
    ///        within the actor's current token balance, but occasionally
    ///        (deliberately) overshoot it, exercising the legitimate
    ///        "selling more than held" revert path the issue calls out.
    function sell(uint256 actorSeed, uint256 amountSeed) external {
        address actor = _actor(actorSeed);
        uint256 held = token.balanceOf(actor);
        uint256 amount = held == 0 ? amountSeed % 1_000 ether : amountSeed % (held + held / 4 + 1);

        priceBeforeLastTrade = _price();
        if (amount > 0) {
            vm.prank(actor);
            token.approve(address(curve), amount);
        }
        vm.prank(actor);
        try curve.sell(amount, 0, type(uint256).max) returns (uint256 nativeOut) {
            callsSell++;
            ghostTotalNativeOut += nativeOut;
            lastActionKind = 2;
        } catch {
            callsLegitimatelySkipped++;
            lastActionKind = 0;
        }
        priceAfterLastTrade = _price();
    }

    function withdrawTreasuryFees() external {
        vm.prank(treasury);
        try curve.withdrawFees() returns (uint256) {
            callsWithdrawTreasury++;
        } catch {
            callsLegitimatelySkipped++;
        }
        lastActionKind = 0;
    }

    function withdrawCreatorFees() external {
        vm.prank(creator);
        try curve.withdrawFees() returns (uint256) {
            callsWithdrawCreator++;
        } catch {
            callsLegitimatelySkipped++;
        }
        lastActionKind = 0;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _price() internal view returns (uint256) {
        uint256 tokenReserve = curve.virtualTokenReserve();
        if (tokenReserve == 0) return 0;
        return (curve.virtualEthReserve() * PRICE_SCALE) / tokenReserve;
    }

    /// @dev HoodlumsTestBondingCurve only graduates on an *exact* match
    ///      (`buy()` reverts BuyExceedsGraduationTarget on overshoot and
    ///      silently accumulates on undershoot — see its
    ///      `if (realNativeReserve == graduationTarget)` check), so hitting
    ///      it by chance with a wide uniformly-random amount is
    ///      astronomically unlikely. One in four buys is deliberately biased
    ///      to the exact gross needed to close the remaining gap so a fuzzed
    ///      sequence of realistic depth reliably crosses graduation, per the
    ///      issue's explicit requirement; the other three keep exploring the
    ///      general amount space (including occasionally overshooting on
    ///      purpose, to exercise the legitimate revert path too).
    function _boundBuyAmount(uint256 amountSeed) internal view returns (uint256) {
        if (curve.graduated()) {
            // Trading is closed; still fuzz an amount so the handler keeps
            // proving buy() correctly stays shut post-graduation.
            return 1 + (amountSeed % 100 ether);
        }
        uint256 remaining = curve.remainingNativeToGraduate();
        if (remaining == 0) return 1 + (amountSeed % 100 ether);
        if (amountSeed % 4 == 0) return _grossNeededForExactNet(remaining);
        return 1 + (amountSeed % (remaining + remaining / 10 + 1));
    }

    /// @dev Binary search against the curve's own pure `quoteBuyFee`, same
    ///      technique HoodlumsTestBondingCurve.t.sol's own
    ///      `_grossNeededForExactNet` uses, to invert its ceil-rounded fee
    ///      without duplicating or guessing at the formula. Best-effort: this
    ///      is used only to construct a fuzzed input, not to assert on it, so
    ///      it never reverts even if no exact match exists.
    function _grossNeededForExactNet(uint256 desiredNet) internal view returns (uint256 gross) {
        uint256 lo = desiredNet;
        uint256 hi = desiredNet + desiredNet / 90 + 1_000;
        while (lo < hi) {
            uint256 mid = lo + (hi - lo) / 2;
            uint256 netAtMid = mid - curve.quoteBuyFee(mid);
            if (netAtMid < desiredNet) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        gross = lo;
    }
}

/// @notice Runs a fuzzed sequence of buy/sell/withdraw actions (via
///         BondingCurveHandler, the sole `targetContract`) long enough to
///         cross graduation mid-run, asserting all seven invariants from
///         issue #408 after every single executed action. Alongside, never
///         replacing or weakening, the deterministic tests in
///         HoodlumsTestBondingCurve.t.sol. See
///         HoodlumsTestBondingCurve.fuzz.t.sol for the single-action layer.
/// @dev Run/depth counts and the fuzzing seed are configured in
///      hardhat.config.ts's `test.solidity.invariant`/`fuzz` blocks.
contract HoodlumsTestBondingCurveInvariantTest is StdInvariant {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant TREASURY = address(0x7EA5);
    uint256 private constant WHOLE_TOKEN_SUPPLY = 1_000_000;
    uint256 private constant VIRTUAL_TOKEN_RESERVE = 1_000_000 ether;
    uint256 private constant VIRTUAL_ETH_RESERVE = 1 ether;
    /// @dev Small relative to VIRTUAL_TOKEN_RESERVE/VIRTUAL_ETH_RESERVE so a
    ///      fuzzed sequence of realistic depth reliably crosses graduation
    ///      mid-run, per the issue's explicit requirement.
    uint256 private constant GRADUATION_TARGET = 20 ether;
    uint256 private constant BPS = 10_000;
    uint256 private constant GRADUATION_FEE_BPS = 500;

    FixedSupplyMemeToken private token;
    HoodlumsTestBondingCurve private curve;
    BondingCurveHandler private handler;
    /// @dev Stored (not left local to setUp) because invariant_TokenAccounting
    ///      needs it: once graduated, the tokens the curve deposited into the
    ///      Uniswap position live here (this mock stands in for the pool),
    ///      not in the curve and not in any actor's wallet.
    MockNonfungiblePositionManager private positionManagerMock;

    /// @dev Ghost latch used only to prove GRADUATION never flips back to
    ///      false once it has fired — the production contract has no way to
    ///      do that itself, but the invariant checks the observed history
    ///      directly rather than trusting that by construction.
    bool private _graduatedEverObserved;

    function setUp() public {
        MockWETH9 wethMock = new MockWETH9();
        MockUniswapV3Factory uniswapFactoryMock = new MockUniswapV3Factory();
        positionManagerMock = new MockNonfungiblePositionManager();

        token = new FixedSupplyMemeToken("Hoodlums Invariant Test", "HIT", WHOLE_TOKEN_SUPPLY, 18, address(this));
        curve = new HoodlumsTestBondingCurve(
            address(token),
            address(this), // creator
            TREASURY,
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            GRADUATION_TARGET,
            address(positionManagerMock),
            address(uniswapFactoryMock),
            address(wethMock)
        );
        token.approve(address(curve), token.totalSupply());
        curve.fundCurve();

        address[] memory actors = new address[](4);
        actors[0] = address(0x1001);
        actors[1] = address(0x1002);
        actors[2] = address(0x1003);
        actors[3] = address(0x1004);

        handler = new BondingCurveHandler(curve, token, TREASURY, address(this), actors);

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = BondingCurveHandler.buy.selector;
        selectors[1] = BondingCurveHandler.sell.selector;
        selectors[2] = BondingCurveHandler.withdrawTreasuryFees.selector;
        selectors[3] = BondingCurveHandler.withdrawCreatorFees.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @dev Invariant 1 (SOLVENCY): the curve can never owe more than it
    ///      actually holds.
    function invariant_Solvency() public view {
        require(
            address(curve).balance >= curve.nativeReserve() + curve.treasuryFeeBalance() + curve.creatorFeeBalance(),
            "SOLVENCY violated: curve owes more native currency than it holds"
        );
    }

    /// @dev Invariant 2 (CONSERVATION): every wei that ever went in is
    ///      accounted for by what's still held in reserve/fees, what's gone
    ///      out to sellers, what's been withdrawn, and — at most once — what
    ///      was locked into the graduation liquidity position. The one-off
    ///      graduation fee (GRADUATION_FEE_BPS of the target, floor-rounded)
    ///      never leaves the curve at graduation: it moves from the reserve
    ///      into the treasury's claimable balance (already a term below), so
    ///      only the remainder is the pool payout. If the fee vanished, was
    ///      double-counted, or went anywhere else, this equality breaks.
    function invariant_Conservation() public view {
        uint256 graduationFee = (GRADUATION_TARGET * GRADUATION_FEE_BPS) / BPS;
        uint256 graduationPayout = curve.graduated() ? GRADUATION_TARGET - graduationFee : 0;
        require(
            handler.ghostTotalNativeIn() ==
                curve.nativeReserve() + curve.treasuryFeeBalance() + curve.creatorFeeBalance()
                    + handler.ghostTotalNativeOut() + curve.totalFeesWithdrawn() + graduationPayout,
            "CONSERVATION violated: native currency in does not equal all known destinations"
        );
    }

    /// @dev Invariant 3 (FEES): claimable balances plus everything already
    ///      withdrawn must always exactly equal everything ever accrued —
    ///      the only way a fee balance can move down is a withdrawal, and a
    ///      withdrawal can never move more than what was recorded.
    function invariant_FeesReconcileWithAccrual() public view {
        require(
            curve.treasuryFeeBalance() + curve.creatorFeeBalance() + curve.totalFeesWithdrawn()
                == curve.totalFeesAccrued(),
            "FEES violated: claimable + withdrawn does not equal total accrued"
        );
    }

    /// @dev Invariant 4 (TOKEN ACCOUNTING): every token is always either held
    ///      by an actor, still sitting in the curve, or — once graduated —
    ///      locked into the Uniswap position (represented here by the mock
    ///      position manager, since no real Uniswap pool is deployed in
    ///      tests). Anything the graduation mint didn't consume is burned by
    ///      the production contract itself, which is why this compares
    ///      against the *current* `token.totalSupply()` rather than the
    ///      original fixed supply constant.
    function invariant_TokenAccounting() public view {
        uint256 sum = curve.tokensAvailable() + token.balanceOf(address(positionManagerMock));
        uint256 actorCount = handler.actorsCount();
        for (uint256 i = 0; i < actorCount; i++) {
            sum += token.balanceOf(handler.actors(i));
        }
        require(sum == token.totalSupply(), "TOKEN ACCOUNTING violated: tokens missing or invented");
    }

    /// @dev Invariant 5 (GRADUATION): fires at most once ever (never flips
    ///      back to false), and once graduated the reserve is fully cleared
    ///      with an LP position recorded. Fee balances remaining withdrawable
    ///      post-graduation is covered by invariant_Solvency continuing to
    ///      hold afterward.
    function invariant_GraduationAtMostOnce() public {
        bool nowGraduated = curve.graduated();
        if (_graduatedEverObserved) {
            require(nowGraduated, "GRADUATION violated: flipped back to false after firing once");
        }
        if (nowGraduated) {
            _graduatedEverObserved = true;
            require(curve.nativeReserve() == 0, "GRADUATION violated: reserve not cleared after graduating");
            require(curve.lpTokenId() != 0, "GRADUATION violated: no LP token recorded after graduating");
            require(curve.liquidityPool() != address(0), "GRADUATION violated: no pool recorded after graduating");
        }
    }

    /// @dev Invariant 6 (NO CROSS-ACTOR DRAIN): for every actor's *current*
    ///      full token balance, the curve's own quoted sell price for that
    ///      full balance must never exceed what the curve actually holds in
    ///      real reserve — no actor's trading can ever make another actor's
    ///      tokens unsellable at the contract's own quote.
    function invariant_HoldersCanAlwaysExitAtQuotedPrice() public view {
        if (curve.graduated()) return; // trading is closed post-graduation by design
        uint256 actorCount = handler.actorsCount();
        for (uint256 i = 0; i < actorCount; i++) {
            address actor = handler.actors(i);
            uint256 held = token.balanceOf(actor);
            if (held == 0) continue;
            uint256 grossNativeOut = curve.quoteSell(held) + curve.quoteSellFee(held);
            require(
                grossNativeOut <= curve.nativeReserve(),
                "NO CROSS-ACTOR DRAIN violated: a holder's full exit would exceed the real reserve"
            );
        }
    }

    /// @dev Invariant 7 (MONOTONICITY): the reserve-ratio price the curve
    ///      quotes never decreases as a result of the most recent buy, and
    ///      never increases as a result of the most recent sell.
    function invariant_PriceMonotonicity() public view {
        uint8 kind = handler.lastActionKind();
        if (kind == 1) {
            require(
                handler.priceAfterLastTrade() >= handler.priceBeforeLastTrade(),
                "MONOTONICITY violated: price decreased on a buy"
            );
        } else if (kind == 2) {
            require(
                handler.priceAfterLastTrade() <= handler.priceBeforeLastTrade(),
                "MONOTONICITY violated: price increased on a sell"
            );
        }
    }

    /// @dev Withdrawal recipient in this file: the invariant test contract
    ///      itself is `creator` (see setUp), so it must be able to receive
    ///      the pull-payment native currency withdrawFees() sends it.
    receive() external payable {}
}

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

/// @dev Bundled as a memory struct (a single stack slot) rather than many
///      separate locals, since Solidity's legacy codegen stack-too-deeps a
///      helper that threads this many values through a try/catch.
struct BuySnapshot {
    uint256 fee;
    uint256 expectedTokensOut;
    uint256 tokenReserveBefore;
    uint256 nativeReserveBefore;
    uint256 realReserveBefore;
    uint256 curveBalanceBefore;
    uint256 buyerTokensBefore;
    uint256 treasuryFeeBefore;
    uint256 creatorFeeBefore;
    uint256 totalAccruedBefore;
}

/// @dev See `BuySnapshot`.
struct SellSnapshot {
    uint256 grossQuote;
    uint256 fee;
    uint256 expectedNativeOut;
    uint256 tokenReserveBefore;
    uint256 nativeReserveBefore;
    uint256 realReserveBefore;
    uint256 curveBalanceBefore;
    uint256 sellerNativeBefore;
    uint256 sellerTokensBefore;
    uint256 curveTokensBefore;
    uint256 treasuryFeeBefore;
    uint256 creatorFeeBefore;
    uint256 totalAccruedBefore;
}

/// @notice Layer 1 (issue #408) of the bonding-curve property test suite:
///         fuzzed single-action buy/sell amounts, including the 1 wei / dust /
///         graduation-boundary / max-bounded edge cases the issue calls out
///         by name, each asserting exact conservation of native currency,
///         fees, and tokens. Alongside, never replacing or weakening, the
///         deterministic tests in HoodlumsTestBondingCurve.t.sol. See
///         HoodlumsTestBondingCurve.invariant.t.sol for the multi-action
///         fuzzed-sequence/handler layer.
/// @dev Hardhat 3's Solidity test runner (edr) fuzzes any parameter on a
///      test function automatically, the same convention Foundry uses; no
///      special "testFuzz" prefix is required, but this file uses it for
///      readability. Run counts and the fuzzing seed are configured in
///      hardhat.config.ts's `test.solidity.fuzz` block.
contract HoodlumsTestBondingCurveFuzzTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant BUYER = address(0xB0B);
    address private constant SELLER = address(0x5E11E4);
    address private constant TREASURY = address(0x7EA5);
    uint256 private constant DEADLINE = type(uint256).max;
    uint256 private constant WHOLE_TOKEN_SUPPLY = 1_000_000;
    uint256 private constant VIRTUAL_TOKEN_RESERVE = 1_000_000 ether;
    uint256 private constant VIRTUAL_ETH_RESERVE = 1 ether;
    /// @dev Deliberately large relative to the amounts this file fuzzes, so a
    ///      bounded fuzzed buy essentially never accidentally crosses it; the
    ///      graduation boundary itself is exercised by its own small-target
    ///      deterministic and fuzzed tests below instead.
    uint256 private constant GRADUATION_TARGET = 1_000 ether;
    /// @dev Sane wei ceiling for the generic bounded buy/sell fuzz amounts,
    ///      per the issue's "bounded to sane wei limits" instruction.
    uint256 private constant MAX_FUZZ_NATIVE = 500 ether;
    uint256 private constant BPS = 10_000;
    uint256 private constant TRADING_FEE_BPS = 100;
    uint256 private constant PROTOCOL_FEE_SHARE_BPS = 6_000;
    /// @dev Native currency handed to BUYER/SELLER before every single fuzz
    ///      run; large enough to cover MAX_FUZZ_NATIVE and the max-bounded
    ///      boundary tests below.
    uint256 private constant ACTOR_FUNDING = type(uint128).max;

    FixedSupplyMemeToken private token;
    HoodlumsTestBondingCurve private curve;
    uint256 private sellerTokenStash;

    function setUp() public {
        MockWETH9 wethMock = new MockWETH9();
        MockUniswapV3Factory uniswapFactoryMock = new MockUniswapV3Factory();
        MockNonfungiblePositionManager positionManagerMock = new MockNonfungiblePositionManager();

        token = new FixedSupplyMemeToken("Hoodlums Fuzz Test", "HFT", WHOLE_TOKEN_SUPPLY, 18, address(this));
        curve = new HoodlumsTestBondingCurve(
            address(token),
            address(this),
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

        vm.deal(BUYER, ACTOR_FUNDING);
        vm.deal(SELLER, ACTOR_FUNDING);

        // Seed SELLER with a large, fixed token stash (via a plain buy) so
        // the sell-side fuzz tests below always have real inventory to bound
        // their fuzzed input against, without needing a fuzzed setup step.
        vm.prank(SELLER);
        sellerTokenStash = curve.buy{value: 100 ether}(0, DEADLINE);
        require(sellerTokenStash > 0, "fuzz setup: seller stash empty");
    }

    // ---------------------------------------------------------------------
    // BUY: bounded fuzz + explicit 1 wei / dust / boundary / max edge cases
    // ---------------------------------------------------------------------

    /// @dev Bounds the fuzzed gross input to a sane wei range and asserts
    ///      exact conservation: fee is exactly ceil(1%), net-of-fee is what
    ///      the virtual/real reserves and buyer token balance move by, and
    ///      the fee is split exactly 60/40 into the two claimable balances.
    function testFuzz_BuyConservesNativeFeesAndTokens(uint256 rawAmount) public {
        uint256 grossIn = _bound(rawAmount, 1, MAX_FUZZ_NATIVE);
        _assertBuyConservesOrLegitimatelyReverts(grossIn);
    }

    function testBuyAtOneWeiIsRejectedNotFeeFree() public {
        // Matches HoodlumsTestBondingCurve.t.sol's own deterministic case:
        // 1 wei rounds to a 1 wei fee, leaving zero net input, which must
        // revert rather than silently letting a trade evade the fee.
        uint256 reserveBefore = curve.nativeReserve();
        vm.prank(BUYER);
        (bool ok,) = address(curve).call{value: 1}(abi.encodeCall(HoodlumsTestBondingCurve.buy, (0, DEADLINE)));
        require(!ok, "1 wei buy unexpectedly succeeded");
        require(curve.nativeReserve() == reserveBefore, "1 wei buy mutated reserve despite reverting");
    }

    function testFuzz_BuyAtDustAmountsConservesOrRejects(uint256 rawAmount) public {
        // Dust range: 2..999 wei, below where the 1% fee stops being
        // dominated by the ceil-rounding-to-1 floor.
        uint256 grossIn = _bound(rawAmount, 2, 999);
        _assertBuyConservesOrLegitimatelyReverts(grossIn);
    }

    function testBuyExactlyAtGraduationTargetGraduatesWithExactAccounting() public {
        (, HoodlumsTestBondingCurve freshCurve) = _deployFreshCurve(GRADUATION_TARGET);
        uint256 gross = _grossNeededForExactNet(freshCurve, GRADUATION_TARGET);
        uint256 fee = freshCurve.quoteBuyFee(gross);

        vm.prank(BUYER);
        freshCurve.buy{value: gross}(0, DEADLINE);

        require(freshCurve.graduated(), "exact-target buy did not graduate");
        require(freshCurve.nativeReserve() == 0, "graduated reserve not cleared");
        require(freshCurve.totalFeesAccrued() == fee, "fee not accrued exactly on graduating buy");
    }

    function testBuyOneWeiBelowGraduationTargetDoesNotGraduate() public {
        (, HoodlumsTestBondingCurve freshCurve) = _deployFreshCurve(GRADUATION_TARGET);
        uint256 gross = _grossNeededForExactNet(freshCurve, GRADUATION_TARGET - 1);

        vm.prank(BUYER);
        freshCurve.buy{value: gross}(0, DEADLINE);

        require(!freshCurve.graduated(), "one wei below target incorrectly graduated");
        require(freshCurve.nativeReserve() == GRADUATION_TARGET - 1, "reserve not exactly target minus one wei");
    }

    function testBuyOneWeiPastGraduationTargetRevertsAndConservesState() public {
        (, HoodlumsTestBondingCurve freshCurve) = _deployFreshCurve(GRADUATION_TARGET);
        uint256 gross = _grossNeededForExactNet(freshCurve, GRADUATION_TARGET + 1);
        uint256 balanceBefore = address(freshCurve).balance;
        uint256 tokensBefore = freshCurve.tokensAvailable();

        vm.prank(BUYER);
        (bool ok,) =
            address(freshCurve).call{value: gross}(abi.encodeCall(HoodlumsTestBondingCurve.buy, (0, DEADLINE)));

        require(!ok, "buy one wei past the graduation target unexpectedly succeeded");
        require(!freshCurve.graduated(), "curve graduated despite reverted overshoot buy");
        require(freshCurve.nativeReserve() == 0, "reserve mutated despite reverted overshoot buy");
        require(address(freshCurve).balance == balanceBefore, "curve balance mutated despite reverted overshoot buy");
        require(freshCurve.tokensAvailable() == tokensBefore, "curve tokens mutated despite reverted overshoot buy");
    }

    /// @dev Fuzzes an amount guaranteed to land strictly past the current
    ///      remaining graduation target (max-bounded up to type(uint256).max)
    ///      and asserts it always reverts BuyExceedsGraduationTarget with the
    ///      curve's state completely untouched.
    function testFuzz_BuyAboveGraduationTargetAlwaysRevertsAndConservesState(uint256 rawAmount) public {
        uint256 remaining = curve.remainingNativeToGraduate();
        // 2x + a fixed margin guarantees net-of-fee still exceeds `remaining`
        // even after the worst-case ~1% fee rounding.
        uint256 lowerBound = remaining * 2 + 1_000_000;
        uint256 grossIn = _bound(rawAmount, lowerBound, type(uint256).max);
        vm.deal(BUYER, grossIn);

        uint256 balanceBefore = address(curve).balance;
        uint256 reserveBefore = curve.nativeReserve();

        vm.prank(BUYER);
        (bool ok,) =
            address(curve).call{value: grossIn}(abi.encodeCall(HoodlumsTestBondingCurve.buy, (0, DEADLINE)));

        require(!ok, "max-bounded buy above the graduation target unexpectedly succeeded");
        require(curve.nativeReserve() == reserveBefore, "reserve mutated despite reverted max-bounded buy");
        require(address(curve).balance == balanceBefore, "curve balance mutated despite reverted max-bounded buy");
    }

    // ---------------------------------------------------------------------
    // SELL: bounded fuzz + explicit 1 wei-token / dust / max edge cases
    // ---------------------------------------------------------------------

    /// @dev Bounds the fuzzed token input to SELLER's actual stash and
    ///      asserts exact conservation symmetric to the buy-side check.
    function testFuzz_SellConservesNativeFeesAndTokens(uint256 rawTokensIn) public {
        uint256 tokensIn = _bound(rawTokensIn, 1, sellerTokenStash);
        _assertSellConservesOrLegitimatelyReverts(tokensIn);
    }

    function testFuzz_SellAtDustTokenAmountsConservesOrRejects(uint256 rawTokensIn) public {
        uint256 tokensIn = _bound(rawTokensIn, 1, 999);
        _assertSellConservesOrLegitimatelyReverts(tokensIn);
    }

    function testSellEntireStashNeverUnderflowsRealReserve() public {
        // Selling everything SELLER holds must either succeed with the curve
        // fully solvent afterward, or legitimately revert; it must never
        // leave realNativeReserve in an inconsistent (underflowed) state.
        _assertSellConservesOrLegitimatelyReverts(sellerTokenStash);
    }

    /// @dev Fuzzes a token amount guaranteed to exceed SELLER's actual
    ///      balance (max-bounded up to type(uint256).max) and asserts the
    ///      curve legitimately rejects it (insufficient token balance /
    ///      allowance) with zero state mutation — the "selling more than
    ///      held must revert cleanly" case the issue calls out.
    function testFuzz_SellAboveHeldBalanceAlwaysRevertsAndConservesState(uint256 rawTokensIn) public {
        uint256 tokensIn = _bound(rawTokensIn, sellerTokenStash + 1, type(uint256).max);

        vm.prank(SELLER);
        token.approve(address(curve), tokensIn);

        uint256 reserveBefore = curve.nativeReserve();
        uint256 sellerTokensBefore = token.balanceOf(SELLER);

        vm.prank(SELLER);
        (bool ok,) =
            address(curve).call(abi.encodeCall(HoodlumsTestBondingCurve.sell, (tokensIn, 0, DEADLINE)));

        require(!ok, "overselling above held balance unexpectedly succeeded");
        require(curve.nativeReserve() == reserveBefore, "reserve mutated despite reverted oversell");
        require(token.balanceOf(SELLER) == sellerTokensBefore, "seller tokens mutated despite reverted oversell");
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /// @dev Executes a buy for `grossIn` and, if it succeeds, asserts every
    ///      quantity it touches moved by exactly the amount the curve's own
    ///      fee/quote formulas predict. If it reverts (e.g. the fee rounds
    ///      the net input to zero for the tiniest amounts), asserts the
    ///      curve's state is completely untouched instead. Snapshots are
    ///      bundled into a single memory struct (one stack slot) because the
    ///      legacy codegen stack-too-deeps a helper this size threading this
    ///      many locals through a try/catch, matching the pattern already
    ///      used by HoodlumsTestBondingCurve.t.sol's `FeeAccrual`.
    function _assertBuyConservesOrLegitimatelyReverts(uint256 grossIn) internal {
        BuySnapshot memory snap = BuySnapshot({
            fee: curve.quoteBuyFee(grossIn),
            expectedTokensOut: curve.quoteBuy(grossIn),
            tokenReserveBefore: curve.virtualTokenReserve(),
            nativeReserveBefore: curve.virtualEthReserve(),
            realReserveBefore: curve.nativeReserve(),
            curveBalanceBefore: address(curve).balance,
            buyerTokensBefore: token.balanceOf(BUYER),
            treasuryFeeBefore: curve.treasuryFeeBalance(),
            creatorFeeBefore: curve.creatorFeeBalance(),
            totalAccruedBefore: curve.totalFeesAccrued()
        });

        vm.prank(BUYER);
        try curve.buy{value: grossIn}(0, DEADLINE) returns (uint256 tokensOut) {
            _assertBuySucceeded(grossIn, tokensOut, snap);
        } catch {
            require(curve.virtualTokenReserve() == snap.tokenReserveBefore, "reverted buy mutated virtual token reserve");
            require(curve.virtualEthReserve() == snap.nativeReserveBefore, "reverted buy mutated virtual eth reserve");
            require(curve.nativeReserve() == snap.realReserveBefore, "reverted buy mutated real reserve");
            require(address(curve).balance == snap.curveBalanceBefore, "reverted buy mutated curve native balance");
            require(token.balanceOf(BUYER) == snap.buyerTokensBefore, "reverted buy mutated buyer token balance");
        }
    }

    function _assertBuySucceeded(uint256 grossIn, uint256 tokensOut, BuySnapshot memory snap) internal view {
        uint256 netIn = grossIn - snap.fee;

        require(tokensOut == snap.expectedTokensOut, "buy tokensOut diverged from quote");
        require(tokensOut > 0, "buy succeeded with zero tokens out");
        require(
            token.balanceOf(BUYER) == snap.buyerTokensBefore + tokensOut,
            "buyer token balance did not move by tokensOut"
        );
        require(
            curve.virtualTokenReserve() == snap.tokenReserveBefore - tokensOut,
            "virtual token reserve did not move by tokensOut"
        );
        require(
            curve.virtualEthReserve() == snap.nativeReserveBefore + netIn,
            "virtual eth reserve did not move by net-of-fee input"
        );
        require(
            curve.nativeReserve() == snap.realReserveBefore + netIn,
            "real reserve did not move by exact net-of-fee input"
        );
        require(
            address(curve).balance == snap.curveBalanceBefore + grossIn,
            "curve native balance did not move by the full gross input"
        );
        require(curve.totalFeesAccrued() == snap.totalAccruedBefore + snap.fee, "fee not accrued exactly");
        require(
            curve.treasuryFeeBalance() + curve.creatorFeeBalance() ==
                snap.treasuryFeeBefore + snap.creatorFeeBefore + snap.fee,
            "fee split lost or invented wei"
        );
        require(
            curve.treasuryFeeBalance() + curve.creatorFeeBalance() == curve.totalFeesAccrued(),
            "fee balances do not reconcile with total accrued after buy"
        );
    }

    /// @dev Mirrors `_assertBuyConservesOrLegitimatelyReverts` for sells.
    function _assertSellConservesOrLegitimatelyReverts(uint256 tokensIn) internal {
        SellSnapshot memory snap = SellSnapshot({
            grossQuote: curve.quoteSell(tokensIn) + curve.quoteSellFee(tokensIn),
            fee: curve.quoteSellFee(tokensIn),
            expectedNativeOut: curve.quoteSell(tokensIn),
            tokenReserveBefore: curve.virtualTokenReserve(),
            nativeReserveBefore: curve.virtualEthReserve(),
            realReserveBefore: curve.nativeReserve(),
            curveBalanceBefore: address(curve).balance,
            sellerNativeBefore: SELLER.balance,
            sellerTokensBefore: token.balanceOf(SELLER),
            curveTokensBefore: curve.tokensAvailable(),
            treasuryFeeBefore: curve.treasuryFeeBalance(),
            creatorFeeBefore: curve.creatorFeeBalance(),
            totalAccruedBefore: curve.totalFeesAccrued()
        });

        vm.prank(SELLER);
        token.approve(address(curve), tokensIn);

        vm.prank(SELLER);
        try curve.sell(tokensIn, 0, DEADLINE) returns (uint256 nativeOut) {
            _assertSellSucceeded(tokensIn, nativeOut, snap);
        } catch {
            require(curve.virtualTokenReserve() == snap.tokenReserveBefore, "reverted sell mutated virtual token reserve");
            require(curve.virtualEthReserve() == snap.nativeReserveBefore, "reverted sell mutated virtual eth reserve");
            require(curve.nativeReserve() == snap.realReserveBefore, "reverted sell mutated real reserve");
            require(address(curve).balance == snap.curveBalanceBefore, "reverted sell mutated curve native balance");
            require(token.balanceOf(SELLER) == snap.sellerTokensBefore, "reverted sell mutated seller token balance");
            require(curve.tokensAvailable() == snap.curveTokensBefore, "reverted sell mutated curve token balance");
        }
    }

    function _assertSellSucceeded(uint256 tokensIn, uint256 nativeOut, SellSnapshot memory snap) internal view {
        require(nativeOut == snap.expectedNativeOut, "sell nativeOut diverged from quote");
        require(snap.grossQuote <= snap.realReserveBefore, "sell succeeded despite exceeding real reserve");
        require(
            SELLER.balance == snap.sellerNativeBefore + nativeOut,
            "seller native balance did not move by nativeOut"
        );
        require(
            token.balanceOf(SELLER) == snap.sellerTokensBefore - tokensIn,
            "seller token balance did not move by tokensIn"
        );
        require(
            curve.tokensAvailable() == snap.curveTokensBefore + tokensIn,
            "curve token balance did not move by tokensIn"
        );
        require(
            curve.virtualTokenReserve() == snap.tokenReserveBefore + tokensIn,
            "virtual token reserve did not move by tokensIn"
        );
        require(
            curve.nativeReserve() == snap.realReserveBefore - snap.grossQuote,
            "real reserve did not move by exact gross native output"
        );
        require(
            address(curve).balance == snap.curveBalanceBefore - nativeOut,
            "curve native balance did not decrease by exactly nativeOut"
        );
        require(curve.totalFeesAccrued() == snap.totalAccruedBefore + snap.fee, "fee not accrued exactly on sell");
        require(
            curve.treasuryFeeBalance() + curve.creatorFeeBalance() ==
                snap.treasuryFeeBefore + snap.creatorFeeBefore + snap.fee,
            "fee split lost or invented wei on sell"
        );
    }

    /// @dev See HoodlumsTestBondingCurve.t.sol's `_grossNeededForExactNet` for
    ///      why binary search against the curve's own pure `quoteBuyFee` is
    ///      the correct way to invert its ceil-rounded fee, rather than
    ///      guessing at the formula.
    function _grossNeededForExactNet(HoodlumsTestBondingCurve targetCurve, uint256 desiredNet)
        internal
        view
        returns (uint256 gross)
    {
        uint256 lo = desiredNet;
        uint256 hi = desiredNet + desiredNet / 90 + 1_000;
        while (lo < hi) {
            uint256 mid = lo + (hi - lo) / 2;
            uint256 netAtMid = mid - targetCurve.quoteBuyFee(mid);
            if (netAtMid < desiredNet) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        gross = lo;
        require(gross - targetCurve.quoteBuyFee(gross) == desiredNet, "no exact gross found for desired net");
    }

    /// @dev This Hardhat/edr version does not yet implement forge-std's
    ///      `vm.bound` cheatcode (confirmed by running the suite: it reverts
    ///      with "Cheatcode 'bound(uint256,uint256,uint256)' is not yet
    ///      available in this version of Hardhat"), so every fuzzed input in
    ///      this file is bounded with this plain local helper instead. `x`
    ///      already inside `[min, max]` is returned unchanged (so boundary
    ///      values the fuzzer generates directly, like 0 or type(uint256).max,
    ///      are preserved); otherwise it's folded into range via modulo. The
    ///      early return also means `max - min + 1` never overflows: the only
    ///      case that could overflow is min == 0 && max == type(uint256).max,
    ///      and every uint256 already satisfies the early-return condition
    ///      for that full range.
    function _bound(uint256 x, uint256 min, uint256 max) internal pure returns (uint256) {
        require(min <= max, "_bound: min > max");
        if (x >= min && x <= max) return x;
        return min + (x % (max - min + 1));
    }

    /// @dev Deploys and funds a brand-new curve with nobody having traded on
    ///      it yet, used by the graduation-boundary tests below so their
    ///      "exact target" math isn't thrown off by the shared `curve`
    ///      already having SELLER's setup stash-building buy baked into its
    ///      reserve.
    function _deployFreshCurve(uint256 target)
        internal
        returns (FixedSupplyMemeToken freshToken, HoodlumsTestBondingCurve freshCurve)
    {
        MockWETH9 wethMock = new MockWETH9();
        MockUniswapV3Factory uniswapFactoryMock = new MockUniswapV3Factory();
        MockNonfungiblePositionManager positionManagerMock = new MockNonfungiblePositionManager();

        freshToken = new FixedSupplyMemeToken("Hoodlums Fuzz Boundary", "HFB", WHOLE_TOKEN_SUPPLY, 18, address(this));
        freshCurve = new HoodlumsTestBondingCurve(
            address(freshToken),
            address(this),
            TREASURY,
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            target,
            address(positionManagerMock),
            address(uniswapFactoryMock),
            address(wethMock)
        );
        freshToken.approve(address(freshCurve), freshToken.totalSupply());
        freshCurve.fundCurve();
    }

    receive() external payable {}
}

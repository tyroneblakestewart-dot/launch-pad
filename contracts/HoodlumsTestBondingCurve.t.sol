// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FixedSupplyMemeToken} from "./FixedSupplyMemeToken.sol";
import {HoodlumsTestBondingCurve} from "./HoodlumsTestBondingCurve.sol";
import {HoodlumsTestLiquidityPool} from "./HoodlumsTestLiquidityPool.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function prank(address nextCaller) external;
    function warp(uint256 newTimestamp) external;
}

/// @dev Holds fees without a fallback that can accept native currency, used to
///      prove a reverting recipient cannot block trades, graduation, or the
///      other recipient's withdrawal.
contract RevertingFeeRecipient {
    error Nope();

    receive() external payable {
        revert Nope();
    }
}

/// @dev Attempts to reenter `withdrawFees()` from within its own receive hook.
///      The curve address is wired in after both contracts exist, since the
///      curve constructor requires the treasury address up front.
contract ReentrantFeeClaimant {
    HoodlumsTestBondingCurve public curve;
    bool public reentrantWithdrawSucceeded;
    bool private attempted;

    function setCurve(HoodlumsTestBondingCurve curve_) external {
        curve = curve_;
    }

    function claim() external returns (uint256) {
        return curve.withdrawFees();
    }

    receive() external payable {
        if (!attempted) {
            attempted = true;
            (bool ok,) = address(curve).call(
                abi.encodeCall(HoodlumsTestBondingCurve.withdrawFees, ())
            );
            reentrantWithdrawSucceeded = ok;
        }
    }
}

/// @dev Attempts to reenter `sell()` from within its own receive hook, which
///      fires while the curve is paying out the native proceeds of a sell.
contract ReentrantSeller {
    HoodlumsTestBondingCurve public curve;
    FixedSupplyMemeToken public token;
    bool public reentrantSellSucceeded;
    bool private attempted;

    constructor(HoodlumsTestBondingCurve curve_, FixedSupplyMemeToken token_) {
        curve = curve_;
        token = token_;
    }

    receive() external payable {
        if (!attempted) {
            attempted = true;
            uint256 remaining = token.balanceOf(address(this));
            if (remaining > 0) {
                (bool ok,) = address(curve).call(
                    abi.encodeCall(HoodlumsTestBondingCurve.sell, (remaining, 0, type(uint256).max))
                );
                reentrantSellSucceeded = ok;
            }
        }
    }
}

contract HoodlumsTestBondingCurveTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant BUYER = address(0xB0B);
    address private constant STRANGER = address(0xBAD);
    address private constant TREASURY = address(0x7EA5);
    uint256 private constant DEADLINE = type(uint256).max;
    uint256 private constant WHOLE_TOKEN_SUPPLY = 1_000_000;
    uint256 private constant TOKEN_SUPPLY = WHOLE_TOKEN_SUPPLY * 1 ether;
    uint256 private constant VIRTUAL_TOKEN_RESERVE = 1_000_000 ether;
    uint256 private constant VIRTUAL_ETH_RESERVE = 1 ether;
    uint256 private constant DEFAULT_GRADUATION_TARGET = 1 ether;
    uint256 private constant BPS = 10_000;
    uint256 private constant TRADING_FEE_BPS = 100;
    uint256 private constant PROTOCOL_FEE_SHARE_BPS = 6_000;

    FixedSupplyMemeToken private token;
    HoodlumsTestBondingCurve private curve;

    function setUp() public {
        vm.deal(address(this), 100 ether);
        token = _deployToken(WHOLE_TOKEN_SUPPLY);
        curve = _deployFundedCurve(token, DEFAULT_GRADUATION_TARGET);
    }

    function testCreatorFundsCurveWithCompleteSupplyAndKeepsNoUnlockedAllocation() public view {
        require(curve.funded(), "curve not funded");
        require(curve.curveTokenSupply() == TOKEN_SUPPLY, "wrong curve supply");
        require(curve.tokensAvailable() == TOKEN_SUPPLY, "complete supply not held by curve");
        require(address(curve.token()) == address(token), "wrong token");
        require(curve.creator() == address(this), "wrong creator");
        require(curve.treasury() == TREASURY, "wrong treasury");
        require(curve.minimumCurveFunding() <= TOKEN_SUPPLY, "curve underfunded");
        require(curve.remainingNativeToGraduate() == DEFAULT_GRADUATION_TARGET, "wrong target remainder");
    }

    function testConstructorRejectsZeroCreatorOrTreasury() public {
        FixedSupplyMemeToken freshToken = _deployToken(WHOLE_TOKEN_SUPPLY);

        (bool zeroCreator,) = address(this).call(
            abi.encodeCall(
                HoodlumsTestBondingCurveTest._deployCurveWith,
                (freshToken, address(0), TREASURY, DEFAULT_GRADUATION_TARGET)
            )
        );
        require(!zeroCreator, "zero creator accepted");

        (bool zeroTreasury,) = address(this).call(
            abi.encodeCall(
                HoodlumsTestBondingCurveTest._deployCurveWith,
                (freshToken, address(this), address(0), DEFAULT_GRADUATION_TARGET)
            )
        );
        require(!zeroTreasury, "zero treasury accepted");
    }

    function _deployCurveWith(
        FixedSupplyMemeToken curveToken,
        address creator_,
        address treasury_,
        uint256 target
    ) external returns (HoodlumsTestBondingCurve) {
        return new HoodlumsTestBondingCurve(
            address(curveToken),
            creator_,
            treasury_,
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            target
        );
    }

    function testOnlyCreatorCanFundAndCurveCannotBeFundedTwice() public {
        FixedSupplyMemeToken freshToken = _deployToken(WHOLE_TOKEN_SUPPLY);
        HoodlumsTestBondingCurve unfunded = _deployCurve(freshToken, DEFAULT_GRADUATION_TARGET);
        freshToken.approve(address(unfunded), freshToken.totalSupply());

        vm.prank(STRANGER);
        (bool strangerFunded,) = address(unfunded).call(
            abi.encodeCall(HoodlumsTestBondingCurve.fundCurve, ())
        );
        require(!strangerFunded, "non-creator funded curve");

        (bool fundedTwice,) = address(curve).call(
            abi.encodeCall(HoodlumsTestBondingCurve.fundCurve, ())
        );
        require(!fundedTwice, "curve funded twice");
    }

    function testFundingRejectsAnyCreatorAllocationOutsideTheCurve() public {
        FixedSupplyMemeToken freshToken = _deployToken(WHOLE_TOKEN_SUPPLY);
        HoodlumsTestBondingCurve unfunded = _deployCurve(freshToken, DEFAULT_GRADUATION_TARGET);
        uint256 fullSupply = freshToken.totalSupply();

        freshToken.transfer(STRANGER, 1 ether);
        freshToken.approve(address(unfunded), fullSupply);

        (bool partialFunding,) = address(unfunded).call(
            abi.encodeCall(HoodlumsTestBondingCurve.fundCurve, ())
        );
        require(!partialFunding, "partial creator allocation accepted");
        require(!unfunded.funded(), "failed funding activated curve");
        require(unfunded.tokensAvailable() == 0, "failed funding moved tokens");

        vm.prank(STRANGER);
        freshToken.transfer(address(this), 1 ether);
        unfunded.fundCurve();

        require(unfunded.funded(), "complete supply funding rejected");
        require(unfunded.tokensAvailable() == fullSupply, "curve missing full supply");
        require(freshToken.balanceOf(address(this)) == 0, "creator retained tokens");
    }

    function testFullSupplyMustStillBeLargeEnoughForGraduationLiquidity() public {
        FixedSupplyMemeToken smallToken = _deployToken(100);
        HoodlumsTestBondingCurve unfunded = _deployCurve(smallToken, DEFAULT_GRADUATION_TARGET);
        smallToken.approve(address(unfunded), smallToken.totalSupply());

        (bool underfunded,) = address(unfunded).call(
            abi.encodeCall(HoodlumsTestBondingCurve.fundCurve, ())
        );
        require(!underfunded, "insufficient full supply accepted");
        require(!unfunded.funded(), "underfunded curve activated");
        require(unfunded.tokensAvailable() == 0, "underfunded curve moved tokens");
    }

    function testBuyUsesLiveQuoteAndUpdatesVirtualAndRealReservesNetOfFee() public {
        uint256 nativeIn = 0.1 ether;
        uint256 expectedFee = (nativeIn * TRADING_FEE_BPS) / BPS; // exact: 0.1 ether is fee-clean
        uint256 expectedNetIn = nativeIn - expectedFee;
        uint256 quotedTokens = curve.quoteBuy(nativeIn);
        uint256 tokenReserveBefore = curve.virtualTokenReserve();
        uint256 nativeReserveBefore = curve.virtualEthReserve();

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 tokensOut = curve.buy{value: nativeIn}(quotedTokens, DEADLINE);

        require(tokensOut == quotedTokens, "buy differed from quote");
        require(token.balanceOf(BUYER) == quotedTokens, "buyer missing tokens");
        require(curve.virtualTokenReserve() == tokenReserveBefore - quotedTokens, "token reserve wrong");
        require(curve.virtualEthReserve() == nativeReserveBefore + expectedNetIn, "native reserve wrong");
        require(curve.nativeReserve() == expectedNetIn, "real native reserve wrong");
        require(curve.actualNativeBalance() == nativeIn, "actual native balance should include fee");
        require(
            curve.remainingNativeToGraduate() == DEFAULT_GRADUATION_TARGET - expectedNetIn,
            "remaining target wrong"
        );
        require(curve.totalFeesAccrued() == expectedFee, "fee not accrued");
    }

    function testBuyChargesExact1PercentFeeSplit60_40BetweenTreasuryAndCreator() public {
        (, HoodlumsTestBondingCurve freshCurve) = _deployFreshFundedCurve(5 ether);

        uint256 grossIn = 100_000; // 1% fee == 1,000 wei exactly, no rounding needed
        uint256 expectedFee = freshCurve.quoteBuyFee(grossIn);
        require(expectedFee == 1_000, "unexpected fee for exact test amount");

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        freshCurve.buy{value: grossIn}(0, DEADLINE);

        uint256 expectedTreasuryShare = (expectedFee * PROTOCOL_FEE_SHARE_BPS) / BPS;
        uint256 expectedCreatorShare = expectedFee - expectedTreasuryShare;

        require(freshCurve.treasuryFeeBalance() == expectedTreasuryShare, "treasury share wrong");
        require(freshCurve.creatorFeeBalance() == expectedCreatorShare, "creator share wrong");
        require(freshCurve.totalFeesAccrued() == expectedFee, "total accrued wrong");
        require(
            freshCurve.treasuryFeeBalance() + freshCurve.creatorFeeBalance() == expectedFee,
            "60/40 split lost wei"
        );
    }

    function testSellChargesExact1PercentFeeSplit60_40BetweenTreasuryAndCreator() public {
        (FixedSupplyMemeToken freshToken, HoodlumsTestBondingCurve freshCurve) =
            _deployFreshFundedCurve(5 ether);

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 bought = freshCurve.buy{value: 0.5 ether}(0, DEADLINE);

        uint256 tokensIn = bought / 3;
        uint256 grossFeeBefore = freshCurve.quoteSellFee(tokensIn);
        require(grossFeeBefore > 0, "expected nonzero fee on sell");

        vm.prank(BUYER);
        freshToken.approve(address(freshCurve), tokensIn);
        vm.prank(BUYER);
        freshCurve.sell(tokensIn, 0, DEADLINE);

        uint256 buyFee = freshCurve.quoteBuyFee(0.5 ether);
        uint256 totalExpectedFee = buyFee + grossFeeBefore;

        uint256 expectedTreasuryShareOnBuy = (buyFee * PROTOCOL_FEE_SHARE_BPS) / BPS;
        uint256 carryAfterBuy = (buyFee * PROTOCOL_FEE_SHARE_BPS) % BPS;
        uint256 scaledSell = grossFeeBefore * PROTOCOL_FEE_SHARE_BPS + carryAfterBuy;
        uint256 expectedTreasuryShareOnSell = scaledSell / BPS;
        uint256 expectedTreasuryTotal = expectedTreasuryShareOnBuy + expectedTreasuryShareOnSell;
        uint256 expectedCreatorTotal = totalExpectedFee - expectedTreasuryTotal;

        require(freshCurve.treasuryFeeBalance() == expectedTreasuryTotal, "treasury share wrong after sell");
        require(freshCurve.creatorFeeBalance() == expectedCreatorTotal, "creator share wrong after sell");
        require(freshCurve.totalFeesAccrued() == totalExpectedFee, "total accrued wrong after sell");
        require(
            freshCurve.treasuryFeeBalance() + freshCurve.creatorFeeBalance() == freshCurve.totalFeesAccrued(),
            "60/40 split lost wei on sell"
        );
    }

    function testFeeAccumulationAcrossManyMixedTradesMatchesDeterministicCarryModel() public {
        (FixedSupplyMemeToken mixedToken, HoodlumsTestBondingCurve mixedCurve) =
            _deployFreshFundedCurve(10 ether);

        uint256 expectedTreasury;
        uint256 expectedCreator;
        uint256 expectedCarry;
        uint256 expectedTotal;

        vm.deal(BUYER, 5 ether);

        uint256[5] memory buyAmounts = [
            uint256(0.037 ether),
            0.011 ether,
            0.123 ether,
            0.0009 ether,
            0.5 ether
        ];
        for (uint256 i = 0; i < buyAmounts.length; i++) {
            uint256 grossIn = buyAmounts[i];
            uint256 fee = mixedCurve.quoteBuyFee(grossIn);
            (expectedTreasury, expectedCreator, expectedCarry, expectedTotal) = _applyExpectedFee(
                fee,
                expectedTreasury,
                expectedCreator,
                expectedCarry,
                expectedTotal
            );

            vm.prank(BUYER);
            mixedCurve.buy{value: grossIn}(0, DEADLINE);
        }

        vm.prank(BUYER);
        mixedToken.approve(address(mixedCurve), type(uint256).max);

        uint256[3] memory sellAmounts = [uint256(1_000 ether), 4_321 ether, 777 ether];
        for (uint256 i = 0; i < sellAmounts.length; i++) {
            uint256 tokensIn = sellAmounts[i];
            uint256 fee = mixedCurve.quoteSellFee(tokensIn);
            (expectedTreasury, expectedCreator, expectedCarry, expectedTotal) = _applyExpectedFee(
                fee,
                expectedTreasury,
                expectedCreator,
                expectedCarry,
                expectedTotal
            );

            vm.prank(BUYER);
            mixedCurve.sell(tokensIn, 0, DEADLINE);
        }

        require(mixedCurve.treasuryFeeBalance() == expectedTreasury, "treasury balance drifted");
        require(mixedCurve.creatorFeeBalance() == expectedCreator, "creator balance drifted");
        require(mixedCurve.treasuryShareCarry() == expectedCarry, "carry drifted");
        require(mixedCurve.totalFeesAccrued() == expectedTotal, "total accrued drifted");
        require(
            mixedCurve.treasuryFeeBalance() + mixedCurve.creatorFeeBalance() == mixedCurve.totalFeesAccrued(),
            "fee split does not reconcile with total accrued"
        );
    }

    function _applyExpectedFee(
        uint256 fee,
        uint256 treasuryBalance,
        uint256 creatorBalance,
        uint256 carry,
        uint256 total
    ) internal pure returns (uint256, uint256, uint256, uint256) {
        if (fee == 0) return (treasuryBalance, creatorBalance, carry, total);
        uint256 scaled = fee * PROTOCOL_FEE_SHARE_BPS + carry;
        uint256 treasuryShare = scaled / BPS;
        uint256 newCarry = scaled % BPS;
        uint256 creatorShare = fee - treasuryShare;
        return (treasuryBalance + treasuryShare, creatorBalance + creatorShare, newCarry, total + fee);
    }

    function testWithdrawFeesPaysExactAccruedAmountsAndZerosCallerBalance() public {
        uint256 nativeIn = 0.2 ether;
        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        curve.buy{value: nativeIn}(0, DEADLINE);

        uint256 treasuryOwed = curve.treasuryFeeBalance();
        uint256 creatorOwed = curve.creatorFeeBalance();
        require(treasuryOwed > 0 && creatorOwed > 0, "fees not accrued");

        uint256 treasuryBalanceBefore = TREASURY.balance;
        vm.prank(TREASURY);
        uint256 treasuryWithdrawn = curve.withdrawFees();
        require(treasuryWithdrawn == treasuryOwed, "treasury withdrew wrong amount");
        require(TREASURY.balance == treasuryBalanceBefore + treasuryOwed, "treasury balance wrong");
        require(curve.treasuryFeeBalance() == 0, "treasury balance not zeroed");

        uint256 creatorBalanceBefore = address(this).balance;
        uint256 creatorWithdrawn = curve.withdrawFees();
        require(creatorWithdrawn == creatorOwed, "creator withdrew wrong amount");
        require(address(this).balance == creatorBalanceBefore + creatorOwed, "creator balance wrong");
        require(curve.creatorFeeBalance() == 0, "creator balance not zeroed");

        require(curve.totalFeesWithdrawn() == treasuryOwed + creatorOwed, "total withdrawn wrong");

        (bool doubleWithdraw,) = address(curve).call(
            abi.encodeCall(HoodlumsTestBondingCurve.withdrawFees, ())
        );
        require(!doubleWithdraw, "double withdrawal succeeded");

        vm.prank(STRANGER);
        (bool strangerWithdraw,) = address(curve).call(
            abi.encodeCall(HoodlumsTestBondingCurve.withdrawFees, ())
        );
        require(!strangerWithdraw, "non-recipient withdrawal succeeded");
    }

    function testRevertingFeeRecipientCannotBlockTradesOrTheOtherRecipient() public {
        RevertingFeeRecipient revertingTreasury = new RevertingFeeRecipient();
        FixedSupplyMemeToken revToken = _deployToken(WHOLE_TOKEN_SUPPLY);
        HoodlumsTestBondingCurve revCurve = new HoodlumsTestBondingCurve(
            address(revToken),
            address(this),
            address(revertingTreasury),
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            5 ether
        );
        revToken.approve(address(revCurve), revToken.totalSupply());
        revCurve.fundCurve();

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 bought = revCurve.buy{value: 0.3 ether}(0, DEADLINE);
        require(bought > 0, "buy blocked by reverting treasury");
        require(revCurve.treasuryFeeBalance() > 0, "treasury fee not accrued");
        require(revCurve.creatorFeeBalance() > 0, "creator fee not accrued");

        vm.prank(BUYER);
        revToken.approve(address(revCurve), bought / 2);
        vm.prank(BUYER);
        uint256 sold = revCurve.sell(bought / 2, 0, DEADLINE);
        require(sold > 0, "sell blocked by reverting treasury");

        vm.prank(address(revertingTreasury));
        (bool revertingWithdraw,) = address(revCurve).call(
            abi.encodeCall(HoodlumsTestBondingCurve.withdrawFees, ())
        );
        require(!revertingWithdraw, "reverting treasury withdrawal unexpectedly succeeded");
        require(revCurve.treasuryFeeBalance() > 0, "treasury balance incorrectly cleared");

        uint256 creatorBalanceBefore = address(this).balance;
        uint256 creatorOwed = revCurve.creatorFeeBalance();
        uint256 creatorWithdrawn = revCurve.withdrawFees();
        require(creatorWithdrawn == creatorOwed, "creator withdrawal amount wrong");
        require(address(this).balance == creatorBalanceBefore + creatorOwed, "creator did not receive fees");
        require(revCurve.creatorFeeBalance() == 0, "creator balance not cleared");
    }

    function testGraduationTriggersOnlyWhenPostFeeReserveReachesTarget() public {
        uint256 target = 0.99 ether;
        (, HoodlumsTestBondingCurve graduatingCurve) = _deployFreshFundedCurve(target);

        vm.deal(BUYER, 2 ether);

        // First buy: gross 0.5 ether -> fee 0.005 ether -> net 0.495 ether, well
        // short of the 0.99 ether target.
        vm.prank(BUYER);
        graduatingCurve.buy{value: 0.5 ether}(0, DEADLINE);
        require(!graduatingCurve.graduated(), "graduated before post-fee target reached");
        require(graduatingCurve.nativeReserve() == 0.495 ether, "unexpected post-fee reserve");

        // Second buy: another gross 0.5 ether -> another net 0.495 ether,
        // bringing the post-fee reserve to exactly the 0.99 ether target.
        vm.prank(BUYER);
        graduatingCurve.buy{value: 0.5 ether}(0, DEADLINE);
        require(graduatingCurve.graduated(), "curve did not graduate at exact post-fee target");
        require(graduatingCurve.nativeReserve() == 0, "graduated reserve not cleared");
    }

    function testFeesRemainOutsidePoolLiquidityAndWithdrawableAfterGraduation() public {
        uint256 target = 0.99 ether;
        (, HoodlumsTestBondingCurve graduatingCurve) = _deployFreshFundedCurve(target);

        vm.deal(BUYER, 2 ether);
        vm.prank(BUYER);
        graduatingCurve.buy{value: 0.5 ether}(0, DEADLINE);
        vm.prank(BUYER);
        graduatingCurve.buy{value: 0.5 ether}(0, DEADLINE);
        require(graduatingCurve.graduated(), "curve did not graduate");

        address poolAddress = graduatingCurve.liquidityPool();
        HoodlumsTestLiquidityPool pool = HoodlumsTestLiquidityPool(payable(poolAddress));
        require(pool.reserveEth() == target, "fees leaked into pool liquidity");

        uint256 treasuryOwed = graduatingCurve.treasuryFeeBalance();
        uint256 creatorOwed = graduatingCurve.creatorFeeBalance();
        require(treasuryOwed > 0 && creatorOwed > 0, "fees not accrued before graduation");
        require(
            graduatingCurve.actualNativeBalance() >= treasuryOwed + creatorOwed,
            "fee liability exceeds contract balance after graduation"
        );

        uint256 treasuryBalanceBefore = TREASURY.balance;
        vm.prank(TREASURY);
        uint256 treasuryWithdrawn = graduatingCurve.withdrawFees();
        require(treasuryWithdrawn == treasuryOwed, "treasury could not withdraw post-graduation fees");
        require(TREASURY.balance == treasuryBalanceBefore + treasuryOwed, "treasury did not receive fees");

        uint256 creatorBalanceBefore = address(this).balance;
        uint256 creatorWithdrawn = graduatingCurve.withdrawFees();
        require(creatorWithdrawn == creatorOwed, "creator could not withdraw post-graduation fees");
        require(address(this).balance == creatorBalanceBefore + creatorOwed, "creator did not receive fees");
    }

    function testSellReturnsNetNativeAndRestoresCurveInventory() public {
        uint256 nativeIn = 0.2 ether;
        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 bought = curve.buy{value: nativeIn}(0, DEADLINE);

        uint256 tokensIn = bought / 2;
        vm.prank(BUYER);
        token.approve(address(curve), tokensIn);

        uint256 nativeOutQuote = curve.quoteSell(tokensIn);
        uint256 sellFee = curve.quoteSellFee(tokensIn);
        uint256 buyerNativeBefore = BUYER.balance;
        uint256 curveTokensBefore = curve.tokensAvailable();
        uint256 realReserveBefore = curve.nativeReserve();
        uint256 treasuryFeeBefore = curve.treasuryFeeBalance();
        uint256 creatorFeeBefore = curve.creatorFeeBalance();

        vm.prank(BUYER);
        uint256 nativeOut = curve.sell(tokensIn, nativeOutQuote, DEADLINE);

        require(nativeOut == nativeOutQuote, "sell differed from quote");
        require(BUYER.balance == buyerNativeBefore + nativeOut, "seller missing native currency");
        require(curve.tokensAvailable() == curveTokensBefore + tokensIn, "sold tokens not returned");
        require(token.balanceOf(BUYER) == bought - tokensIn, "seller token balance wrong");
        require(curve.nativeReserve() == realReserveBefore - (nativeOut + sellFee), "real reserve not reduced by gross");
        require(
            curve.treasuryFeeBalance() + curve.creatorFeeBalance() == treasuryFeeBefore + creatorFeeBefore + sellFee,
            "fee not accrued on sell"
        );
    }

    function testSellCannotUseVirtualNativeReserveThatDoesNotExist() public {
        uint256 tokensIn = 1_000 ether;

        // Simulate tokens acquired outside the normal curve path. The real-reserve
        // check must still stop virtual native liquidity from being withdrawn.
        vm.prank(address(curve));
        token.transfer(STRANGER, tokensIn);
        vm.prank(STRANGER);
        token.approve(address(curve), tokensIn);

        vm.prank(STRANGER);
        (bool success,) = address(curve).call(
            abi.encodeCall(HoodlumsTestBondingCurve.sell, (tokensIn, 0, DEADLINE))
        );

        require(!success, "sell drained virtual-only reserve");
        require(token.balanceOf(STRANGER) == tokensIn, "failed sell moved tokens");
    }

    function testOnlyRecordedBuysCountTowardGraduation() public {
        (bool earlyGraduation,) = address(curve).call(
            abi.encodeCall(HoodlumsTestBondingCurve.graduate, ())
        );
        require(!earlyGraduation, "curve graduated before target");

        (bool directPayment,) = address(curve).call{value: 1 wei}("");
        require(!directPayment, "curve accepted direct payment");
        require(curve.nativeReserve() == 0, "direct payment remained in reserve");

        vm.deal(address(curve), 2 ether);
        require(curve.actualNativeBalance() == 2 ether, "forced balance missing");
        require(curve.nativeReserve() == 0, "forced balance counted as reserve");
        require(curve.graduationProgressBps() == 0, "forced balance changed progress");

        (bool forcedGraduation,) = address(curve).call(
            abi.encodeCall(HoodlumsTestBondingCurve.graduate, ())
        );
        require(!forcedGraduation, "forced balance triggered graduation");
    }

    function testTargetBuyAutomaticallyGraduatesAndLocksAllInitialLp() public {
        uint256 target = 0.99 ether;
        uint256 forcedBalance = 0.2 ether;
        (FixedSupplyMemeToken graduatingToken, HoodlumsTestBondingCurve graduatingCurve) =
            _deployFreshFundedCurve(target);
        vm.deal(address(graduatingCurve), forcedBalance);

        vm.deal(BUYER, 2 ether);
        vm.prank(BUYER);
        graduatingCurve.buy{value: 0.5 ether}(0, DEADLINE);
        vm.prank(BUYER);
        graduatingCurve.buy{value: 0.5 ether}(0, DEADLINE);

        require(graduatingCurve.graduated(), "curve did not graduate");
        require(graduatingCurve.graduationProgressBps() == 10_000, "graduation not complete");
        require(graduatingCurve.nativeReserve() == 0, "graduated reserve not cleared");
        require(graduatingCurve.remainingNativeToGraduate() == 0, "graduated target remainder not cleared");

        address poolAddress = graduatingCurve.liquidityPool();
        require(poolAddress != address(0), "pool not created");

        HoodlumsTestLiquidityPool pool = HoodlumsTestLiquidityPool(payable(poolAddress));
        require(pool.token() == address(graduatingToken), "pool uses wrong token");
        require(pool.reserveEth() == target, "post-fee reserve not fully seeded, or fee leaked in");
        require(pool.reserveToken() > 0, "token liquidity missing");
        require(pool.balanceOf(address(1)) == pool.totalSupply(), "initial LP not fully locked");
        require(pool.balanceOf(address(graduatingCurve)) == 0, "curve retained LP tokens");
        require(graduatingToken.balanceOf(address(graduatingCurve)) == 0, "curve retained tokens");
        require(
            address(graduatingCurve).balance ==
                forcedBalance + graduatingCurve.treasuryFeeBalance() + graduatingCurve.creatorFeeBalance(),
            "forced balance plus fees accounting wrong"
        );
    }

    function testTradingStopsAfterGraduation() public {
        uint256 target = 0.99 ether;
        (FixedSupplyMemeToken graduatingToken, HoodlumsTestBondingCurve graduatingCurve) =
            _deployFreshFundedCurve(target);

        vm.deal(BUYER, 2 ether);
        vm.prank(BUYER);
        graduatingCurve.buy{value: 0.5 ether}(0, DEADLINE);
        vm.prank(BUYER);
        uint256 bought = graduatingCurve.buy{value: 0.5 ether}(0, DEADLINE);

        vm.prank(BUYER);
        (bool buySuccess,) = address(graduatingCurve).call{value: 0.01 ether}(
            abi.encodeCall(HoodlumsTestBondingCurve.buy, (0, DEADLINE))
        );
        require(!buySuccess, "buy remained open after graduation");

        vm.prank(BUYER);
        graduatingToken.approve(address(graduatingCurve), bought);
        vm.prank(BUYER);
        (bool sellSuccess,) = address(graduatingCurve).call(
            abi.encodeCall(HoodlumsTestBondingCurve.sell, (bought, 0, DEADLINE))
        );
        require(!sellSuccess, "sell remained open after graduation");
    }

    function testTinyBuysCannotEvadeTheTradingFeeViaRounding() public view {
        for (uint256 grossIn = 1; grossIn <= 500; grossIn++) {
            require(curve.quoteBuyFee(grossIn) > 0, "fee rounded to zero for nonzero gross input");
        }
    }

    function testTinySellsCannotEvadeTheTradingFeeViaRounding() public view {
        for (uint256 tokensIn = 1; tokensIn <= 500; tokensIn++) {
            uint256 netOut = curve.quoteSell(tokensIn);
            uint256 fee = curve.quoteSellFee(tokensIn);
            uint256 gross = netOut + fee;
            if (gross == 0) continue; // curve rounding yields no output at all, not a fee-free trade
            require(fee > 0, "fee rounded to zero for nonzero gross output");
        }
    }

    function testTinyBuyWhereFeeConsumesEntireInputIsRejectedNotFeeFree() public {
        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        (bool tinyBuySuccess,) = address(curve).call{value: 1}(
            abi.encodeCall(HoodlumsTestBondingCurve.buy, (0, DEADLINE))
        );
        require(!tinyBuySuccess, "1 wei buy was accepted fee-free instead of being rejected");
        require(curve.nativeReserve() == 0, "tiny buy affected reserve");
        require(curve.totalFeesAccrued() == 0, "rejected buy should not accrue a fee");
    }

    function testQuoteBuyAndQuoteSellMatchExecutedNetOutputs() public {
        uint256 nativeIn = 0.037 ether;
        uint256 quotedTokens = curve.quoteBuy(nativeIn);

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 tokensOut = curve.buy{value: nativeIn}(quotedTokens, DEADLINE);
        require(tokensOut == quotedTokens, "buy execution diverged from quote");

        uint256 tokensIn = tokensOut / 5;
        vm.prank(BUYER);
        token.approve(address(curve), tokensIn);
        uint256 quotedNativeOut = curve.quoteSell(tokensIn);

        vm.prank(BUYER);
        uint256 nativeOut = curve.sell(tokensIn, quotedNativeOut, DEADLINE);
        require(nativeOut == quotedNativeOut, "sell execution diverged from quote");
    }

    function testReentrancyOnFeeWithdrawalFailsSafely() public {
        ReentrantFeeClaimant claimant = new ReentrantFeeClaimant();
        FixedSupplyMemeToken reToken = _deployToken(WHOLE_TOKEN_SUPPLY);
        HoodlumsTestBondingCurve reCurve = new HoodlumsTestBondingCurve(
            address(reToken),
            address(this),
            address(claimant),
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            DEFAULT_GRADUATION_TARGET
        );
        claimant.setCurve(reCurve);
        reToken.approve(address(reCurve), reToken.totalSupply());
        reCurve.fundCurve();

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        reCurve.buy{value: 0.2 ether}(0, DEADLINE);

        uint256 owed = reCurve.treasuryFeeBalance();
        require(owed > 0, "treasury fee not accrued");

        uint256 withdrawn = claimant.claim();
        require(withdrawn == owed, "claimant did not receive exact accrued amount");
        require(!claimant.reentrantWithdrawSucceeded(), "reentrant withdrawal unexpectedly succeeded");
        require(reCurve.treasuryFeeBalance() == 0, "treasury balance not cleared exactly once");
    }

    function testReentrancyOnSellPathFailsSafely() public {
        (FixedSupplyMemeToken reToken, HoodlumsTestBondingCurve reCurve) =
            _deployFreshFundedCurve(5 ether);
        ReentrantSeller attacker = new ReentrantSeller(reCurve, reToken);
        vm.deal(address(attacker), 1 ether);

        vm.prank(address(attacker));
        uint256 bought = reCurve.buy{value: 0.4 ether}(0, DEADLINE);
        require(bought > 0, "attacker did not receive tokens from buy");

        uint256 tokensToSellNow = bought / 2;
        uint256 remainingAfter = bought - tokensToSellNow;

        vm.prank(address(attacker));
        reToken.approve(address(reCurve), tokensToSellNow);
        vm.prank(address(attacker));
        reCurve.sell(tokensToSellNow, 0, DEADLINE);

        // The receive() hook fired during the sell above and attempted to
        // reenter sell() with the attacker's remaining balance.
        require(!attacker.reentrantSellSucceeded(), "reentrant sell unexpectedly succeeded");
        require(reToken.balanceOf(address(attacker)) == remainingAfter, "reentrant sell moved extra tokens");
    }

    function _deployToken(uint256 wholeSupply) internal returns (FixedSupplyMemeToken freshToken) {
        freshToken = new FixedSupplyMemeToken(
            "Hoodlums Curve Test",
            "HCT",
            wholeSupply,
            18,
            address(this)
        );
    }

    function _deployCurve(FixedSupplyMemeToken curveToken, uint256 target)
        internal
        returns (HoodlumsTestBondingCurve freshCurve)
    {
        freshCurve = new HoodlumsTestBondingCurve(
            address(curveToken),
            address(this),
            TREASURY,
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            target
        );
    }

    function _deployFundedCurve(FixedSupplyMemeToken curveToken, uint256 target)
        internal
        returns (HoodlumsTestBondingCurve fundedCurve)
    {
        fundedCurve = _deployCurve(curveToken, target);
        curveToken.approve(address(fundedCurve), curveToken.totalSupply());
        fundedCurve.fundCurve();
    }

    function _deployFreshFundedCurve(uint256 target)
        internal
        returns (FixedSupplyMemeToken freshToken, HoodlumsTestBondingCurve fundedCurve)
    {
        freshToken = _deployToken(WHOLE_TOKEN_SUPPLY);
        fundedCurve = _deployFundedCurve(freshToken, target);
    }

    receive() external payable {}
}

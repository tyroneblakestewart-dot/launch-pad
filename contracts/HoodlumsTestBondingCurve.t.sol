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

/// @dev Reverts on any native currency transfer, used to prove a hostile fee
///      recipient cannot block trading, graduation, or the other recipient.
contract RevertingReceiver {
    receive() external payable {
        revert("reverting receiver");
    }
}

/// @dev Attempts to reenter `sell()` and `withdrawFees()` from within its own
///      `receive()` callback, used to prove the shared reentrancy guard blocks
///      reentry regardless of which nonReentrant entry point triggered it.
contract ReentrantAttacker {
    HoodlumsTestBondingCurve public curve;
    FixedSupplyMemeToken public token;

    bool public armed;
    bool public triggered;
    uint256 public reentrantSellAmount;
    bool public sellReentryReverted;
    bool public withdrawReentryReverted;

    function configure(HoodlumsTestBondingCurve curve_, FixedSupplyMemeToken token_) external {
        curve = curve_;
        token = token_;
    }

    function approveToken(uint256 amount) external {
        token.approve(address(curve), amount);
    }

    function fund() external {
        curve.fundCurve();
    }

    function buy(uint256 minTokensOut, uint256 deadline) external payable returns (uint256) {
        return curve.buy{value: msg.value}(minTokensOut, deadline);
    }

    function sell(uint256 tokensIn, uint256 minNativeOut, uint256 deadline) external returns (uint256) {
        return curve.sell(tokensIn, minNativeOut, deadline);
    }

    function withdraw() external returns (uint256) {
        return curve.withdrawFees();
    }

    function arm(uint256 reentrantSellAmount_) external {
        armed = true;
        reentrantSellAmount = reentrantSellAmount_;
    }

    receive() external payable {
        if (!armed || triggered) return;
        triggered = true;
        armed = false;

        try curve.sell(reentrantSellAmount, 0, type(uint256).max) {
            // Must never succeed while the outer call still holds the guard.
        } catch {
            sellReentryReverted = true;
        }

        try curve.withdrawFees() {
            // Must never succeed while the outer call still holds the guard.
        } catch {
            withdrawReentryReverted = true;
        }
    }
}

contract HoodlumsTestBondingCurveTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant BUYER = address(0xB0B);
    address private constant STRANGER = address(0xBAD);
    address private constant TREASURY = address(0xFEE5);
    uint256 private constant DEADLINE = type(uint256).max;
    uint256 private constant WHOLE_TOKEN_SUPPLY = 1_000_000;
    uint256 private constant TOKEN_SUPPLY = WHOLE_TOKEN_SUPPLY * 1 ether;
    uint256 private constant VIRTUAL_TOKEN_RESERVE = 1_000_000 ether;
    uint256 private constant VIRTUAL_ETH_RESERVE = 1 ether;
    uint256 private constant DEFAULT_GRADUATION_TARGET = 1 ether;

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
        require(token.balanceOf(address(this)) == 0, "creator retained unlocked tokens");
        require(address(curve.token()) == address(token), "wrong token");
        require(curve.creator() == address(this), "wrong creator");
        require(curve.treasury() == TREASURY, "wrong treasury");
        require(curve.minimumCurveFunding() <= TOKEN_SUPPLY, "curve underfunded");
        require(curve.remainingNativeToGraduate() == DEFAULT_GRADUATION_TARGET, "wrong target remainder");
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

    function testBuyUsesLiveQuoteAndUpdatesVirtualAndRealReserves() public {
        uint256 nativeIn = 0.1 ether;
        uint256 feeAmount = curve.quoteBuyFee(nativeIn);
        uint256 netNativeIn = nativeIn - feeAmount;
        uint256 quotedTokens = curve.quoteBuy(nativeIn);
        uint256 tokenReserveBefore = curve.virtualTokenReserve();
        uint256 nativeReserveBefore = curve.virtualEthReserve();

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 tokensOut = curve.buy{value: nativeIn}(quotedTokens, DEADLINE);

        require(tokensOut == quotedTokens, "buy differed from quote");
        require(token.balanceOf(BUYER) == quotedTokens, "buyer missing tokens");
        require(curve.virtualTokenReserve() == tokenReserveBefore - quotedTokens, "token reserve wrong");
        require(curve.virtualEthReserve() == nativeReserveBefore + netNativeIn, "native reserve wrong");
        require(curve.nativeReserve() == netNativeIn, "real native reserve wrong");
        require(curve.actualNativeBalance() == nativeIn, "actual native balance wrong");
        require(
            curve.remainingNativeToGraduate() == DEFAULT_GRADUATION_TARGET - netNativeIn,
            "remaining target wrong"
        );
        require(
            curve.graduationProgressBps() == (netNativeIn * 10_000) / DEFAULT_GRADUATION_TARGET,
            "graduation progress wrong"
        );
        require(
            curve.claimableFees(TREASURY) + curve.claimableFees(address(this)) == feeAmount,
            "fee not fully accrued to the two recipients"
        );
    }

    function testBuyEnforcesTargetMinimumOutputAndDeadline() public {
        uint256 nativeIn = 0.1 ether;
        uint256 quotedTokens = curve.quoteBuy(nativeIn);
        vm.deal(BUYER, 3 ether);

        vm.prank(BUYER);
        (bool targetSuccess,) = address(curve).call{value: DEFAULT_GRADUATION_TARGET * 2}(
            abi.encodeCall(HoodlumsTestBondingCurve.buy, (0, DEADLINE))
        );
        require(!targetSuccess, "buy exceeded graduation target");
        require(curve.nativeReserve() == 0, "over-target buy retained native currency");

        vm.prank(BUYER);
        (bool slippageSuccess,) = address(curve).call{value: nativeIn}(
            abi.encodeCall(HoodlumsTestBondingCurve.buy, (quotedTokens + 1, DEADLINE))
        );
        require(!slippageSuccess, "unsafe minimum output accepted");
        require(curve.nativeReserve() == 0, "failed buy retained native currency");

        vm.warp(1_000);
        vm.prank(BUYER);
        (bool expiredSuccess,) = address(curve).call{value: nativeIn}(
            abi.encodeCall(HoodlumsTestBondingCurve.buy, (0, 999))
        );
        require(!expiredSuccess, "expired buy accepted");
        require(curve.nativeReserve() == 0, "expired buy retained native currency");
    }

    function testSellReturnsNativeAndRestoresCurveInventory() public {
        uint256 nativeIn = 0.2 ether;
        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 bought = curve.buy{value: nativeIn}(0, DEADLINE);

        uint256 tokensIn = bought / 2;
        vm.prank(BUYER);
        token.approve(address(curve), tokensIn);

        uint256 nativeOutQuote = curve.quoteSell(tokensIn);
        uint256 feeOnSell = curve.quoteSellFee(tokensIn);
        uint256 buyerNativeBefore = BUYER.balance;
        uint256 curveTokensBefore = curve.tokensAvailable();
        uint256 realReserveBefore = curve.nativeReserve();

        vm.prank(BUYER);
        uint256 nativeOut = curve.sell(tokensIn, nativeOutQuote, DEADLINE);

        require(nativeOut == nativeOutQuote, "sell differed from quote");
        require(BUYER.balance == buyerNativeBefore + nativeOut, "seller missing native currency");
        require(curve.tokensAvailable() == curveTokensBefore + tokensIn, "sold tokens not returned");
        require(token.balanceOf(BUYER) == bought - tokensIn, "seller token balance wrong");
        require(
            curve.nativeReserve() == realReserveBefore - (nativeOut + feeOnSell),
            "real reserve not reduced by the gross curve output"
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
        uint256 grossForTarget = 0.5 ether;
        uint256 feeForTarget = curve.quoteBuyFee(grossForTarget);
        uint256 target = grossForTarget - feeForTarget;
        uint256 forcedBalance = 0.2 ether;

        (FixedSupplyMemeToken graduatingToken, HoodlumsTestBondingCurve graduatingCurve) =
            _deployFreshFundedCurve(target);
        vm.deal(address(graduatingCurve), forcedBalance);
        uint256 tokensOutQuote = graduatingCurve.quoteBuy(grossForTarget);

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        graduatingCurve.buy{value: grossForTarget}(tokensOutQuote, DEADLINE);

        require(graduatingCurve.graduated(), "curve did not graduate");
        require(graduatingCurve.graduationProgressBps() == 10_000, "graduation not complete");
        require(graduatingCurve.nativeReserve() == 0, "graduated reserve not cleared");
        require(graduatingCurve.remainingNativeToGraduate() == 0, "graduated target remainder not cleared");

        address poolAddress = graduatingCurve.liquidityPool();
        require(poolAddress != address(0), "pool not created");

        HoodlumsTestLiquidityPool pool = HoodlumsTestLiquidityPool(payable(poolAddress));
        require(pool.token() == address(graduatingToken), "pool uses wrong token");
        require(pool.reserveEth() == target, "fee wei leaked into pool liquidity");
        require(pool.reserveToken() > 0, "token liquidity missing");
        require(pool.balanceOf(address(1)) == pool.totalSupply(), "initial LP not fully locked");
        require(pool.balanceOf(address(graduatingCurve)) == 0, "curve retained LP tokens");
        require(graduatingToken.balanceOf(address(graduatingCurve)) == 0, "curve retained tokens");
        require(
            address(graduatingCurve).balance == forcedBalance + feeForTarget,
            "forced balance plus fee liability accounting wrong"
        );
        require(graduatingCurve.totalClaimableFees() == feeForTarget, "fee liability not preserved after graduation");
    }

    function testTradingStopsAfterGraduation() public {
        uint256 grossForTarget = 0.5 ether;
        uint256 feeForTarget = curve.quoteBuyFee(grossForTarget);
        uint256 target = grossForTarget - feeForTarget;
        (FixedSupplyMemeToken graduatingToken, HoodlumsTestBondingCurve graduatingCurve) =
            _deployFreshFundedCurve(target);

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 bought = graduatingCurve.buy{value: grossForTarget}(0, DEADLINE);
        require(graduatingCurve.graduated(), "curve should have graduated");

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

    function testBuyAccruesExactSixtyFortyFeeSplit() public {
        uint256 nativeIn = 0.37 ether;
        uint256 feeAmount = curve.quoteBuyFee(nativeIn);
        uint256 expectedTreasuryShare = (feeAmount * curve.PROTOCOL_FEE_SHARE_BPS()) / curve.BPS();
        uint256 expectedCreatorShare = feeAmount - expectedTreasuryShare;

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        curve.buy{value: nativeIn}(0, DEADLINE);

        require(curve.treasuryFeeBalance() == expectedTreasuryShare, "treasury share wrong");
        require(curve.creatorFeeBalance() == expectedCreatorShare, "creator share wrong");
        require(curve.claimableFees(TREASURY) == expectedTreasuryShare, "treasury claimable wrong");
        require(curve.claimableFees(address(this)) == expectedCreatorShare, "creator claimable wrong");
        require(curve.totalClaimableFees() == feeAmount, "total claimable wrong");
    }

    function testSellAccruesExactSixtyFortyFeeSplit() public {
        uint256 nativeIn = 0.4 ether;
        uint256 buyFee = curve.quoteBuyFee(nativeIn);
        (uint256 treasuryAfterBuy, uint256 creatorAfterBuy, uint256 remainderAfterBuy) =
            _mirrorAccrue(buyFee, 0, 0, 0);

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 bought = curve.buy{value: nativeIn}(0, DEADLINE);
        require(curve.treasuryFeeBalance() == treasuryAfterBuy, "treasury mismatch after buy leg");
        require(curve.creatorFeeBalance() == creatorAfterBuy, "creator mismatch after buy leg");

        uint256 tokensIn = bought / 3;
        vm.prank(BUYER);
        token.approve(address(curve), tokensIn);
        uint256 sellFee = curve.quoteSellFee(tokensIn);
        (uint256 treasuryAfterSell, uint256 creatorAfterSell,) =
            _mirrorAccrue(sellFee, remainderAfterBuy, treasuryAfterBuy, creatorAfterBuy);

        vm.prank(BUYER);
        curve.sell(tokensIn, 0, DEADLINE);

        require(curve.treasuryFeeBalance() == treasuryAfterSell, "treasury mismatch after sell leg");
        require(curve.creatorFeeBalance() == creatorAfterSell, "creator mismatch after sell leg");
        require(
            curve.treasuryFeeBalance() + curve.creatorFeeBalance() == curve.totalClaimableFees(),
            "total claimable mismatch after sell"
        );
    }

    function testFeeAccountingAccumulatesAcrossManyMixedTradesWithoutDrift() public {
        uint256 expectedRemainder = 0;
        uint256 expectedTreasuryTotal = 0;
        uint256 expectedCreatorTotal = 0;

        vm.deal(BUYER, 5 ether);

        uint256[5] memory buyAmounts = [
            uint256(2 wei),
            999 wei,
            12_345 wei,
            0.001 ether,
            0.02 ether
        ];

        for (uint256 i = 0; i < buyAmounts.length; i++) {
            uint256 nativeIn = buyAmounts[i];
            uint256 feeAmount = curve.quoteBuyFee(nativeIn);
            (expectedTreasuryTotal, expectedCreatorTotal, expectedRemainder) =
                _mirrorAccrue(feeAmount, expectedRemainder, expectedTreasuryTotal, expectedCreatorTotal);

            vm.prank(BUYER);
            (bool success,) = address(curve).call{value: nativeIn}(
                abi.encodeCall(HoodlumsTestBondingCurve.buy, (0, DEADLINE))
            );
            require(success, "mixed-trade buy failed");
            require(curve.treasuryFeeBalance() == expectedTreasuryTotal, "treasury drifted after a buy");
            require(curve.creatorFeeBalance() == expectedCreatorTotal, "creator drifted after a buy");
        }

        uint256 tokensHeld = token.balanceOf(BUYER);
        uint256[3] memory sellFractions = [uint256(7), 5, 2];
        for (uint256 i = 0; i < sellFractions.length; i++) {
            uint256 tokensIn = tokensHeld / (sellFractions[i] * 10);
            if (tokensIn == 0) continue;

            uint256 feeAmount = curve.quoteSellFee(tokensIn);
            (expectedTreasuryTotal, expectedCreatorTotal, expectedRemainder) =
                _mirrorAccrue(feeAmount, expectedRemainder, expectedTreasuryTotal, expectedCreatorTotal);

            vm.prank(BUYER);
            token.approve(address(curve), tokensIn);
            vm.prank(BUYER);
            curve.sell(tokensIn, 0, DEADLINE);

            require(curve.treasuryFeeBalance() == expectedTreasuryTotal, "treasury drifted after a sell");
            require(curve.creatorFeeBalance() == expectedCreatorTotal, "creator drifted after a sell");
        }

        require(
            curve.treasuryFeeBalance() + curve.creatorFeeBalance() == curve.totalClaimableFees(),
            "aggregate fee accounting lost or duplicated wei"
        );
    }

    function testWithdrawFeesPaysExactAccruedAmountsAndZeroesCallerBalance() public {
        uint256 nativeIn = 0.5 ether;
        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        curve.buy{value: nativeIn}(0, DEADLINE);

        uint256 treasuryOwed = curve.treasuryFeeBalance();
        uint256 creatorOwed = curve.creatorFeeBalance();
        require(treasuryOwed > 0 && creatorOwed > 0, "expected fees split between both parties");

        uint256 treasuryBalanceBefore = TREASURY.balance;
        vm.prank(TREASURY);
        uint256 withdrawnByTreasury = curve.withdrawFees();

        require(withdrawnByTreasury == treasuryOwed, "treasury withdrawal amount wrong");
        require(TREASURY.balance == treasuryBalanceBefore + treasuryOwed, "treasury did not receive funds");
        require(curve.treasuryFeeBalance() == 0, "treasury balance not zeroed");
        require(curve.creatorFeeBalance() == creatorOwed, "creator balance disturbed by treasury withdrawal");

        uint256 creatorBalanceBefore = address(this).balance;
        uint256 withdrawnByCreator = curve.withdrawFees();

        require(withdrawnByCreator == creatorOwed, "creator withdrawal amount wrong");
        require(address(this).balance == creatorBalanceBefore + creatorOwed, "creator did not receive funds");
        require(curve.creatorFeeBalance() == 0, "creator balance not zeroed");
    }

    function testRevertingFeeRecipientCannotBlockTradesOrOtherRecipientWithdrawal() public {
        RevertingReceiver revertingTreasury = new RevertingReceiver();
        uint256 target = 0.3 ether;
        FixedSupplyMemeToken freshToken = _deployToken(WHOLE_TOKEN_SUPPLY);
        HoodlumsTestBondingCurve freshCurve = new HoodlumsTestBondingCurve(
            address(freshToken),
            address(this),
            address(revertingTreasury),
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            target
        );
        freshToken.approve(address(freshCurve), freshToken.totalSupply());
        freshCurve.fundCurve();

        vm.deal(BUYER, 2 ether);
        vm.prank(BUYER);
        uint256 bought = freshCurve.buy{value: 0.1 ether}(0, DEADLINE);
        require(freshCurve.treasuryFeeBalance() > 0, "treasury fee did not accrue");

        vm.prank(BUYER);
        freshToken.approve(address(freshCurve), bought / 2);
        vm.prank(BUYER);
        freshCurve.sell(bought / 2, 0, DEADLINE);
        require(freshCurve.creatorFeeBalance() > 0, "creator fee did not accrue");

        uint256 creatorOwed = freshCurve.creatorFeeBalance();
        uint256 creatorBalanceBefore = address(this).balance;
        uint256 withdrawn = freshCurve.withdrawFees();
        require(withdrawn == creatorOwed, "creator withdrawal blocked by reverting treasury");
        require(address(this).balance == creatorBalanceBefore + creatorOwed, "creator did not receive funds");

        uint256 treasuryOwedBefore = freshCurve.treasuryFeeBalance();
        vm.prank(address(revertingTreasury));
        (bool treasuryWithdrawSuccess,) = address(freshCurve).call(
            abi.encodeCall(HoodlumsTestBondingCurve.withdrawFees, ())
        );
        require(!treasuryWithdrawSuccess, "reverting treasury withdrawal should have failed");
        require(freshCurve.treasuryFeeBalance() == treasuryOwedBefore, "failed withdrawal must not zero balance");

        vm.prank(BUYER);
        uint256 boughtAgain = freshCurve.buy{value: 0.01 ether}(0, DEADLINE);
        require(boughtAgain > 0, "buy blocked after reverting treasury withdrawal attempt");
    }

    function testGraduationTriggersOnlyAtPostFeeReserveTarget() public {
        uint256 target = 1 ether;
        (, HoodlumsTestBondingCurve freshCurve) = _deployFreshFundedCurve(target);
        vm.deal(BUYER, 3 ether);

        vm.prank(BUYER);
        freshCurve.buy{value: target}(0, DEADLINE);
        require(!freshCurve.graduated(), "gross-target buy should not graduate; the fee keeps net below target");
        require(freshCurve.nativeReserve() < target, "net reserve should be below target after the first buy");

        uint256 remaining = freshCurve.remainingNativeToGraduate();
        require(remaining > 0, "remaining should reflect the fee withheld from the first buy");

        uint256 exactGross = _grossForExactNet(freshCurve, remaining);
        vm.prank(BUYER);
        freshCurve.buy{value: exactGross}(0, DEADLINE);

        require(freshCurve.graduated(), "curve failed to graduate exactly at the post-fee target");
        require(freshCurve.nativeReserve() == 0, "graduated reserve not cleared");
    }

    function testFeesRemainOutsidePoolLiquidityAndWithdrawableAfterGraduation() public {
        uint256 target = 1 ether;
        (, HoodlumsTestBondingCurve freshCurve) = _deployFreshFundedCurve(target);
        vm.deal(BUYER, 3 ether);

        vm.prank(BUYER);
        freshCurve.buy{value: target}(0, DEADLINE);
        uint256 remaining = freshCurve.remainingNativeToGraduate();
        uint256 exactGross = _grossForExactNet(freshCurve, remaining);
        vm.prank(BUYER);
        freshCurve.buy{value: exactGross}(0, DEADLINE);
        require(freshCurve.graduated(), "curve should have graduated");

        uint256 totalFees = freshCurve.totalClaimableFees();
        require(totalFees > 0, "expected accrued fees");

        address poolAddress = freshCurve.liquidityPool();
        HoodlumsTestLiquidityPool pool = HoodlumsTestLiquidityPool(payable(poolAddress));
        require(pool.reserveEth() == target, "fee wei leaked into pool liquidity");
        require(address(freshCurve).balance == totalFees, "curve balance should equal only outstanding fees");

        uint256 treasuryOwed = freshCurve.treasuryFeeBalance();
        uint256 creatorOwed = freshCurve.creatorFeeBalance();

        vm.prank(TREASURY);
        uint256 treasuryWithdrawn = freshCurve.withdrawFees();
        require(treasuryWithdrawn == treasuryOwed, "treasury withdrawal after graduation wrong");
        require(TREASURY.balance == treasuryOwed, "treasury did not receive the post-graduation fee");

        uint256 creatorBalanceBefore = address(this).balance;
        uint256 creatorWithdrawn = freshCurve.withdrawFees();
        require(creatorWithdrawn == creatorOwed, "creator withdrawal after graduation wrong");
        require(
            address(this).balance == creatorBalanceBefore + creatorOwed,
            "creator did not receive the post-graduation fee"
        );
        require(freshCurve.totalClaimableFees() == 0, "fees remained claimable after both withdrawals");
    }

    function testQuoteFunctionsMatchExecutedNetOutputs() public {
        uint256 nativeIn = 0.05 ether;
        uint256 quotedTokens = curve.quoteBuy(nativeIn);
        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 tokensOut = curve.buy{value: nativeIn}(quotedTokens, DEADLINE);
        require(tokensOut == quotedTokens, "buy quote parity failed");

        uint256 tokensIn = tokensOut / 2;
        vm.prank(BUYER);
        token.approve(address(curve), tokensIn);
        uint256 quotedNativeOut = curve.quoteSell(tokensIn);
        vm.prank(BUYER);
        uint256 nativeOut = curve.sell(tokensIn, quotedNativeOut, DEADLINE);
        require(nativeOut == quotedNativeOut, "sell quote parity failed");
    }

    function testTinyTradesCannotDodgeFeeThroughRounding() public {
        require(curve.quoteBuyFee(1) == 1, "fee on 1 wei input should round up to 1 wei");
        require(curve.quoteBuy(1) == 0, "quote should reflect a fully consumed 1 wei input");

        for (uint256 amount = 1; amount <= 250; amount++) {
            require(curve.quoteBuyFee(amount) > 0, "buy fee must never round to zero for a nonzero input");
        }

        for (uint256 tokensIn = 1; tokensIn <= 250; tokensIn++) {
            uint256 netOut = curve.quoteSell(tokensIn);
            uint256 grossOut = netOut + curve.quoteSellFee(tokensIn);
            if (grossOut > 0) {
                require(
                    curve.quoteSellFee(tokensIn) > 0,
                    "sell fee must never round to zero for a nonzero gross output"
                );
            }
        }

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        (bool tinyBuySuccess,) = address(curve).call{value: 1}(
            abi.encodeCall(HoodlumsTestBondingCurve.buy, (0, DEADLINE))
        );
        require(!tinyBuySuccess, "1 wei buy should be rejected once the fee consumes the entire input");
        require(curve.nativeReserve() == 0, "rejected tiny buy must not affect reserves");
    }

    function testReentrancyDuringSellFailsSafely() public {
        ReentrantAttacker attacker = new ReentrantAttacker();
        attacker.configure(curve, token);

        uint256 bought = attacker.buy{value: 0.1 ether}(0, DEADLINE);
        require(bought > 0, "attacker failed to acquire tokens");

        attacker.approveToken(bought);
        attacker.arm(bought / 2);

        uint256 curveTokensBefore = curve.tokensAvailable();
        uint256 nativeOut = attacker.sell(bought / 2, 0, DEADLINE);

        require(nativeOut > 0, "legitimate sell should still succeed despite the reentrancy attempt");
        require(attacker.sellReentryReverted(), "reentrant sell should have reverted");
        require(attacker.withdrawReentryReverted(), "reentrant withdraw should have reverted");
        require(
            curve.tokensAvailable() == curveTokensBefore + bought / 2,
            "curve token accounting wrong after the sell"
        );
    }

    function testReentrancyDuringWithdrawFeesFailsSafely() public {
        ReentrantAttacker attacker = new ReentrantAttacker();
        FixedSupplyMemeToken freshToken = _deployTokenTo(WHOLE_TOKEN_SUPPLY, address(attacker));
        HoodlumsTestBondingCurve freshCurve = new HoodlumsTestBondingCurve(
            address(freshToken),
            address(attacker),
            TREASURY,
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            DEFAULT_GRADUATION_TARGET
        );
        attacker.configure(freshCurve, freshToken);
        attacker.approveToken(freshToken.totalSupply());
        attacker.fund();

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        freshCurve.buy{value: 0.1 ether}(0, DEADLINE);

        uint256 creatorOwed = freshCurve.creatorFeeBalance();
        require(creatorOwed > 0, "attacker-creator should have accrued fees");

        attacker.arm(0);
        uint256 withdrawn = attacker.withdraw();

        require(withdrawn == creatorOwed, "legitimate withdrawal should still pay the full accrued amount");
        require(attacker.sellReentryReverted(), "reentrant sell during withdrawal should have reverted");
        require(attacker.withdrawReentryReverted(), "reentrant withdraw during withdrawal should have reverted");
        require(freshCurve.creatorFeeBalance() == 0, "creator balance should be zeroed after the withdrawal");
    }

    function testSameAddressTreasuryAndCreatorReceivesCombinedFeesInOneWithdrawal() public {
        address sameParty = address(0xFEED5A3E);
        FixedSupplyMemeToken sameToken = _deployTokenTo(WHOLE_TOKEN_SUPPLY, sameParty);
        HoodlumsTestBondingCurve sameCurve = new HoodlumsTestBondingCurve(
            address(sameToken),
            sameParty,
            sameParty,
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            DEFAULT_GRADUATION_TARGET
        );

        uint256 fullSupply = sameToken.totalSupply();
        vm.prank(sameParty);
        sameToken.approve(address(sameCurve), fullSupply);
        vm.prank(sameParty);
        sameCurve.fundCurve();

        uint256 nativeIn = 0.2 ether;
        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 bought = sameCurve.buy{value: nativeIn}(0, DEADLINE);

        vm.prank(BUYER);
        sameToken.approve(address(sameCurve), bought / 2);
        vm.prank(BUYER);
        sameCurve.sell(bought / 2, 0, DEADLINE);

        uint256 treasuryPortion = sameCurve.treasuryFeeBalance();
        uint256 creatorPortion = sameCurve.creatorFeeBalance();
        require(treasuryPortion > 0 && creatorPortion > 0, "expected fees accrued on both sides");

        uint256 combined = treasuryPortion + creatorPortion;
        require(sameCurve.claimableFees(sameParty) == combined, "claimableFees did not combine both roles");
        require(sameCurve.totalClaimableFees() == combined, "total claimable mismatch");

        vm.prank(sameParty);
        uint256 withdrawn = sameCurve.withdrawFees();

        require(withdrawn == combined, "single withdrawal did not pay the combined balance");
        require(sameParty.balance == combined, "same-party recipient did not receive the combined funds");
        require(sameCurve.treasuryFeeBalance() == 0, "treasury balance not zeroed after the combined withdrawal");
        require(sameCurve.creatorFeeBalance() == 0, "creator balance not zeroed after the combined withdrawal");
        require(sameCurve.claimableFees(sameParty) == 0, "claimable balance not zeroed after the combined withdrawal");
    }

    function _deployToken(uint256 wholeSupply) internal returns (FixedSupplyMemeToken freshToken) {
        freshToken = _deployTokenTo(wholeSupply, address(this));
    }

    function _deployTokenTo(uint256 wholeSupply, address recipient)
        internal
        returns (FixedSupplyMemeToken freshToken)
    {
        freshToken = new FixedSupplyMemeToken(
            "Hoodlums Curve Test",
            "HCT",
            wholeSupply,
            18,
            recipient
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

    /// @dev Mirrors `HoodlumsTestBondingCurve._accrueFee` so tests can predict
    ///      the exact 60/40 split, including the carried rounding remainder,
    ///      across a sequence of trades.
    function _mirrorAccrue(
        uint256 feeAmount,
        uint256 remainderBefore,
        uint256 treasuryTotalBefore,
        uint256 creatorTotalBefore
    )
        internal
        view
        returns (uint256 treasuryTotalAfter, uint256 creatorTotalAfter, uint256 remainderAfter)
    {
        uint256 scaledTreasury = feeAmount * curve.PROTOCOL_FEE_SHARE_BPS() + remainderBefore;
        uint256 treasuryShare = scaledTreasury / curve.BPS();
        remainderAfter = scaledTreasury % curve.BPS();
        uint256 creatorShare = feeAmount - treasuryShare;
        treasuryTotalAfter = treasuryTotalBefore + treasuryShare;
        creatorTotalAfter = creatorTotalBefore + creatorShare;
    }

    /// @dev Finds a gross buy input whose post-fee net exactly equals `desiredNet`.
    ///      Exists for any `desiredNet` because ceil(gross / 100) advances by at
    ///      most 1 per 100-wei block, so net = gross - fee cannot skip a value.
    function _grossForExactNet(HoodlumsTestBondingCurve targetCurve, uint256 desiredNet)
        internal
        view
        returns (uint256)
    {
        if (desiredNet == 0) return 0;
        uint256 bps = targetCurve.BPS();
        uint256 feeBps = targetCurve.TRADING_FEE_BPS();
        uint256 guess = (desiredNet * bps) / (bps - feeBps);
        if (guess < desiredNet) guess = desiredNet;

        for (uint256 delta = 0; delta <= 400; delta++) {
            uint256 candidateHigh = guess + delta;
            if (candidateHigh - targetCurve.quoteBuyFee(candidateHigh) == desiredNet) {
                return candidateHigh;
            }
            if (delta != 0 && guess > delta) {
                uint256 candidateLow = guess - delta;
                if (candidateLow >= desiredNet && candidateLow - targetCurve.quoteBuyFee(candidateLow) == desiredNet) {
                    return candidateLow;
                }
            }
        }
        revert("no exact gross found");
    }

    receive() external payable {}
}

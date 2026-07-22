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

contract HoodlumsTestBondingCurveTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant BUYER = address(0xB0B);
    address private constant STRANGER = address(0xBAD);
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
        uint256 quotedTokens = curve.quoteBuy(nativeIn);
        uint256 tokenReserveBefore = curve.virtualTokenReserve();
        uint256 nativeReserveBefore = curve.virtualEthReserve();

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 tokensOut = curve.buy{value: nativeIn}(quotedTokens, DEADLINE);

        require(tokensOut == quotedTokens, "buy differed from quote");
        require(token.balanceOf(BUYER) == quotedTokens, "buyer missing tokens");
        require(curve.virtualTokenReserve() == tokenReserveBefore - quotedTokens, "token reserve wrong");
        require(curve.virtualEthReserve() == nativeReserveBefore + nativeIn, "native reserve wrong");
        require(curve.nativeReserve() == nativeIn, "real native reserve wrong");
        require(curve.actualNativeBalance() == nativeIn, "actual native balance wrong");
        require(curve.remainingNativeToGraduate() == 0.9 ether, "remaining target wrong");
        require(curve.graduationProgressBps() == 1_000, "graduation progress wrong");
    }

    function testBuyEnforcesTargetMinimumOutputAndDeadline() public {
        uint256 nativeIn = 0.1 ether;
        uint256 quotedTokens = curve.quoteBuy(nativeIn);
        vm.deal(BUYER, 2 ether);

        vm.prank(BUYER);
        (bool targetSuccess,) = address(curve).call{value: DEFAULT_GRADUATION_TARGET + 1}(
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
        uint256 buyerNativeBefore = BUYER.balance;
        uint256 curveTokensBefore = curve.tokensAvailable();

        vm.prank(BUYER);
        uint256 nativeOut = curve.sell(tokensIn, nativeOutQuote, DEADLINE);

        require(nativeOut == nativeOutQuote, "sell differed from quote");
        require(BUYER.balance == buyerNativeBefore + nativeOut, "seller missing native currency");
        require(curve.tokensAvailable() == curveTokensBefore + tokensIn, "sold tokens not returned");
        require(token.balanceOf(BUYER) == bought - tokensIn, "seller token balance wrong");
        require(curve.nativeReserve() == nativeIn - nativeOut, "real reserve not reduced");
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
        uint256 target = 0.5 ether;
        uint256 forcedBalance = 0.2 ether;
        (FixedSupplyMemeToken graduatingToken, HoodlumsTestBondingCurve graduatingCurve) =
            _deployFreshFundedCurve(target);
        vm.deal(address(graduatingCurve), forcedBalance);
        uint256 tokensOutQuote = graduatingCurve.quoteBuy(target);

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        graduatingCurve.buy{value: target}(tokensOutQuote, DEADLINE);

        require(graduatingCurve.graduated(), "curve did not graduate");
        require(graduatingCurve.graduationProgressBps() == 10_000, "graduation not complete");
        require(graduatingCurve.nativeReserve() == 0, "graduated reserve not cleared");
        require(graduatingCurve.remainingNativeToGraduate() == 0, "graduated target remainder not cleared");

        address poolAddress = graduatingCurve.liquidityPool();
        require(poolAddress != address(0), "pool not created");

        HoodlumsTestLiquidityPool pool = HoodlumsTestLiquidityPool(payable(poolAddress));
        require(pool.token() == address(graduatingToken), "pool uses wrong token");
        require(pool.reserveEth() == target, "forced balance entered pool liquidity");
        require(pool.reserveToken() > 0, "token liquidity missing");
        require(pool.balanceOf(address(1)) == pool.totalSupply(), "initial LP not fully locked");
        require(pool.balanceOf(address(graduatingCurve)) == 0, "curve retained LP tokens");
        require(graduatingToken.balanceOf(address(graduatingCurve)) == 0, "curve retained tokens");
        require(address(graduatingCurve).balance == forcedBalance, "forced balance accounting wrong");
    }

    function testTradingStopsAfterGraduation() public {
        uint256 target = 0.5 ether;
        (FixedSupplyMemeToken graduatingToken, HoodlumsTestBondingCurve graduatingCurve) =
            _deployFreshFundedCurve(target);

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 bought = graduatingCurve.buy{value: target}(0, DEADLINE);

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

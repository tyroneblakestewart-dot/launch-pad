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
    uint256 private constant VIRTUAL_TOKEN_RESERVE = 1_000_000 ether;
    uint256 private constant VIRTUAL_ETH_RESERVE = 1 ether;
    uint256 private constant CURVE_TOKEN_SUPPLY = 800_000 ether;
    uint256 private constant DEFAULT_GRADUATION_TARGET = 1 ether;

    FixedSupplyMemeToken private token;
    HoodlumsTestBondingCurve private curve;

    function setUp() public {
        vm.deal(address(this), 100 ether);
        token = new FixedSupplyMemeToken(
            "Hoodlums Curve Test",
            "HCT",
            5_000_000,
            18,
            address(this)
        );
        curve = _deployFundedCurve(DEFAULT_GRADUATION_TARGET);
    }

    function testCreatorFundsCurveOnce() public view {
        require(curve.funded(), "curve not funded");
        require(curve.curveTokenSupply() == CURVE_TOKEN_SUPPLY, "wrong curve supply");
        require(curve.tokensAvailable() == CURVE_TOKEN_SUPPLY, "tokens not held by curve");
        require(address(curve.token()) == address(token), "wrong token");
        require(curve.creator() == address(this), "wrong creator");
        require(curve.minimumCurveFunding() <= CURVE_TOKEN_SUPPLY, "curve underfunded");
    }

    function testOnlyCreatorCanFundAndCurveCannotBeFundedTwice() public {
        HoodlumsTestBondingCurve unfunded = new HoodlumsTestBondingCurve(
            address(token),
            address(this),
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            DEFAULT_GRADUATION_TARGET
        );

        vm.prank(STRANGER);
        (bool strangerFunded,) = address(unfunded).call(
            abi.encodeCall(HoodlumsTestBondingCurve.fundCurve, (1 ether))
        );
        require(!strangerFunded, "non-creator funded curve");

        (bool fundedTwice,) = address(curve).call(
            abi.encodeCall(HoodlumsTestBondingCurve.fundCurve, (1 ether))
        );
        require(!fundedTwice, "curve funded twice");
    }

    function testFundingMustLeaveTokensForGraduationLiquidity() public {
        HoodlumsTestBondingCurve unfunded = new HoodlumsTestBondingCurve(
            address(token),
            address(this),
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            DEFAULT_GRADUATION_TARGET
        );
        uint256 minimumFunding = unfunded.minimumCurveFunding();
        token.approve(address(unfunded), minimumFunding);

        (bool underfunded,) = address(unfunded).call(
            abi.encodeCall(HoodlumsTestBondingCurve.fundCurve, (minimumFunding - 1))
        );
        require(!underfunded, "underfunded curve accepted");
        require(!unfunded.funded(), "failed funding activated curve");
        require(unfunded.tokensAvailable() == 0, "failed funding moved tokens");

        unfunded.fundCurve(minimumFunding);
        require(unfunded.funded(), "minimum valid funding rejected");
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
        require(curve.graduationProgressBps() == 1_000, "graduation progress wrong");
    }

    function testBuyEnforcesMinimumOutputAndDeadline() public {
        uint256 nativeIn = 0.1 ether;
        uint256 quotedTokens = curve.quoteBuy(nativeIn);
        vm.deal(BUYER, 1 ether);

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

    function testGraduationBeforeTargetAndDirectPaymentsAreRejected() public {
        (bool earlyGraduation,) = address(curve).call(
            abi.encodeCall(HoodlumsTestBondingCurve.graduate, ())
        );
        require(!earlyGraduation, "curve graduated before target");

        (bool directPayment,) = address(curve).call{value: 1 wei}("");
        require(!directPayment, "curve accepted direct payment");
        require(curve.nativeReserve() == 0, "direct payment remained in curve");
    }

    function testTargetBuyAutomaticallyGraduatesAndLocksAllInitialLp() public {
        uint256 target = 0.5 ether;
        HoodlumsTestBondingCurve graduatingCurve = _deployFundedCurve(target);
        uint256 tokensOutQuote = graduatingCurve.quoteBuy(target);

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        graduatingCurve.buy{value: target}(tokensOutQuote, DEADLINE);

        require(graduatingCurve.graduated(), "curve did not graduate");
        require(graduatingCurve.graduationProgressBps() == 10_000, "graduation not complete");
        require(graduatingCurve.nativeReserve() == 0, "graduated reserve not cleared");

        address poolAddress = graduatingCurve.liquidityPool();
        require(poolAddress != address(0), "pool not created");

        HoodlumsTestLiquidityPool pool = HoodlumsTestLiquidityPool(payable(poolAddress));
        require(pool.token() == address(token), "pool uses wrong token");
        require(pool.reserveEth() == target, "native liquidity wrong");
        require(pool.reserveToken() > 0, "token liquidity missing");
        require(pool.balanceOf(address(1)) == pool.totalSupply(), "initial LP not fully locked");
        require(pool.balanceOf(address(graduatingCurve)) == 0, "curve retained LP tokens");
        require(token.balanceOf(address(graduatingCurve)) == 0, "curve retained tokens");
        require(address(graduatingCurve).balance == 0, "curve retained native currency");
    }

    function testTradingStopsAfterGraduation() public {
        uint256 target = 0.5 ether;
        HoodlumsTestBondingCurve graduatingCurve = _deployFundedCurve(target);

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        uint256 bought = graduatingCurve.buy{value: target}(0, DEADLINE);

        vm.prank(BUYER);
        (bool buySuccess,) = address(graduatingCurve).call{value: 0.01 ether}(
            abi.encodeCall(HoodlumsTestBondingCurve.buy, (0, DEADLINE))
        );
        require(!buySuccess, "buy remained open after graduation");

        vm.prank(BUYER);
        token.approve(address(graduatingCurve), bought);
        vm.prank(BUYER);
        (bool sellSuccess,) = address(graduatingCurve).call(
            abi.encodeCall(HoodlumsTestBondingCurve.sell, (bought, 0, DEADLINE))
        );
        require(!sellSuccess, "sell remained open after graduation");
    }

    function _deployFundedCurve(uint256 target)
        internal
        returns (HoodlumsTestBondingCurve fundedCurve)
    {
        fundedCurve = new HoodlumsTestBondingCurve(
            address(token),
            address(this),
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            target
        );
        token.approve(address(fundedCurve), CURVE_TOKEN_SUPPLY);
        fundedCurve.fundCurve(CURVE_TOKEN_SUPPLY);
    }

    receive() external payable {}
}

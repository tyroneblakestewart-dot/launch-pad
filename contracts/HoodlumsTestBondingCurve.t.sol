// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {FixedSupplyMemeToken} from "./FixedSupplyMemeToken.sol";
import {HoodlumsTestBondingCurve} from "./HoodlumsTestBondingCurve.sol";
import {
    MockWETH9,
    MockUniswapV3Pool,
    MockUniswapV3Factory,
    MockNonfungiblePositionManager,
    FailingNonfungiblePositionManager
} from "./mocks/UniswapV3Mocks.sol";

struct VmLog {
    bytes32[] topics;
    bytes data;
    address emitter;
}

/// @dev Bundled as a memory struct (a single stack slot) rather than four
///      separate locals, since Solidity's legacy codegen stack-too-deeps a
///      test function that threads several multi-value tuples plus this
///      running state through nested calls.
struct FeeAccrual {
    uint256 treasury;
    uint256 creator;
    uint256 carry;
    uint256 total;
}

struct GraduationDust {
    uint256 leftoverToken;
    uint256 leftoverWeth;
}

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function prank(address nextCaller) external;
    function warp(uint256 newTimestamp) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (VmLog[] memory logs);
    function expectRevert() external;
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
    uint256 private constant EXACT_GRADUATION_TARGET = 4 ether;
    bytes32 private constant GRADUATED_EVENT_SIGNATURE =
        keccak256("Graduated(address,uint256,uint256,uint256)");

    FixedSupplyMemeToken private token;
    HoodlumsTestBondingCurve private curve;

    MockWETH9 private wethMock;
    MockUniswapV3Factory private uniswapFactoryMock;
    MockNonfungiblePositionManager private positionManagerMock;

    function setUp() public {
        vm.deal(address(this), 100 ether);
        wethMock = new MockWETH9();
        uniswapFactoryMock = new MockUniswapV3Factory();
        positionManagerMock = new MockNonfungiblePositionManager();
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

    function testConstructorRejectsZeroUniswapAddresses() public {
        FixedSupplyMemeToken freshToken = _deployToken(WHOLE_TOKEN_SUPPLY);

        (bool zeroPositionManager,) = address(this).call(
            abi.encodeCall(
                HoodlumsTestBondingCurveTest._deployCurveWithUniswapAddresses,
                (freshToken, address(0), address(uniswapFactoryMock), address(wethMock))
            )
        );
        require(!zeroPositionManager, "zero position manager accepted");

        (bool zeroFactory,) = address(this).call(
            abi.encodeCall(
                HoodlumsTestBondingCurveTest._deployCurveWithUniswapAddresses,
                (freshToken, address(positionManagerMock), address(0), address(wethMock))
            )
        );
        require(!zeroFactory, "zero uniswap factory accepted");

        (bool zeroWeth,) = address(this).call(
            abi.encodeCall(
                HoodlumsTestBondingCurveTest._deployCurveWithUniswapAddresses,
                (freshToken, address(positionManagerMock), address(uniswapFactoryMock), address(0))
            )
        );
        require(!zeroWeth, "zero weth9 accepted");
    }

    function _deployCurveWithUniswapAddresses(
        FixedSupplyMemeToken curveToken,
        address positionManager_,
        address uniswapV3Factory_,
        address weth9_
    ) external returns (HoodlumsTestBondingCurve) {
        return new HoodlumsTestBondingCurve(
            address(curveToken),
            address(this),
            TREASURY,
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            DEFAULT_GRADUATION_TARGET,
            positionManager_,
            uniswapV3Factory_,
            weth9_
        );
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
            target,
            address(positionManagerMock),
            address(uniswapFactoryMock),
            address(wethMock)
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

    function testWithdrawFeesCombinesBothSharesWhenTreasuryAndCreatorAreTheSameAddress() public {
        FixedSupplyMemeToken sharedToken = _deployToken(WHOLE_TOKEN_SUPPLY);
        HoodlumsTestBondingCurve sharedCurve = new HoodlumsTestBondingCurve(
            address(sharedToken),
            address(this),
            address(this),
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            DEFAULT_GRADUATION_TARGET,
            address(positionManagerMock),
            address(uniswapFactoryMock),
            address(wethMock)
        );
        sharedToken.approve(address(sharedCurve), sharedToken.totalSupply());
        sharedCurve.fundCurve();

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        sharedCurve.buy{value: 0.2 ether}(0, DEADLINE);

        uint256 treasuryOwed = sharedCurve.treasuryFeeBalance();
        uint256 creatorOwed = sharedCurve.creatorFeeBalance();
        require(treasuryOwed > 0 && creatorOwed > 0, "fees not accrued");

        uint256 combinedExpected = treasuryOwed + creatorOwed;
        require(sharedCurve.claimableFees(address(this)) == combinedExpected, "combined claimable wrong");

        uint256 balanceBefore = address(this).balance;
        uint256 withdrawn = sharedCurve.withdrawFees();
        require(withdrawn == combinedExpected, "combined withdrawal amount wrong");
        require(address(this).balance == balanceBefore + combinedExpected, "combined payment not received");
        require(sharedCurve.treasuryFeeBalance() == 0, "treasury balance not zeroed");
        require(sharedCurve.creatorFeeBalance() == 0, "creator balance not zeroed");
        require(sharedCurve.claimableFees(address(this)) == 0, "claimable not zeroed after withdrawal");
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
            5 ether,
            address(positionManagerMock),
            address(uniswapFactoryMock),
            address(wethMock)
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
        require(poolAddress != address(0), "pool not created");
        uint256 tokenId = graduatingCurve.lpTokenId();
        (address posToken0,,,,, uint256 posAmount0, uint256 posAmount1,) =
            positionManagerMock.positions(tokenId);
        uint256 wethAmount = posToken0 == address(wethMock) ? posAmount0 : posAmount1;
        require(wethAmount == target, "fees leaked into pool liquidity");

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
        require(
            poolAddress == uniswapFactoryMock.getPool(address(graduatingToken), address(wethMock), 10_000),
            "pool address does not match factory record"
        );

        uint256 tokenId = graduatingCurve.lpTokenId();
        require(tokenId != 0, "lp token id not recorded");
        require(positionManagerMock.ownerOf(tokenId) == address(1), "LP NFT not locked at address(1)");

        (address posToken0, address posToken1,,,, uint256 posAmount0, uint256 posAmount1, address posRecipient) =
            positionManagerMock.positions(tokenId);
        require(posRecipient == address(1), "LP NFT mint recipient was not address(1)");
        require(
            (posToken0 == address(graduatingToken) && posToken1 == address(wethMock)) ||
                (posToken0 == address(wethMock) && posToken1 == address(graduatingToken)),
            "pool uses wrong token pair"
        );
        uint256 wethAmount = posToken0 == address(wethMock) ? posAmount0 : posAmount1;
        uint256 tokenAmount = posToken0 == address(wethMock) ? posAmount1 : posAmount0;
        require(wethAmount == target, "post-fee reserve not fully seeded, or fee leaked in");
        require(tokenAmount > 0, "token liquidity missing");

        require(graduatingToken.balanceOf(address(graduatingCurve)) == 0, "curve retained tokens");
        require(wethMock.balanceOf(address(graduatingCurve)) == 0, "curve retained WETH dust");
        require(
            address(graduatingCurve).balance ==
                forcedBalance + graduatingCurve.treasuryFeeBalance() + graduatingCurve.creatorFeeBalance(),
            "forced balance plus fees accounting wrong"
        );
    }

    function testGraduationTriggersAtExactFourEtherTarget() public {
        (, HoodlumsTestBondingCurve graduatingCurve) = _deployFreshFundedCurve(EXACT_GRADUATION_TARGET);

        vm.deal(BUYER, 10 ether);

        uint256 firstNet = 3 ether;
        uint256 firstGross = _grossNeededForExactNet(graduatingCurve, firstNet);
        vm.prank(BUYER);
        graduatingCurve.buy{value: firstGross}(0, DEADLINE);
        require(!graduatingCurve.graduated(), "graduated before exact 4.0 ether target reached");
        require(graduatingCurve.nativeReserve() == firstNet, "unexpected reserve after first buy");

        uint256 remainingNet = EXACT_GRADUATION_TARGET - firstNet;
        uint256 secondGross = _grossNeededForExactNet(graduatingCurve, remainingNet);
        vm.prank(BUYER);
        graduatingCurve.buy{value: secondGross}(0, DEADLINE);

        require(graduatingCurve.graduated(), "curve did not graduate at exact 4.0 ether target");
        require(graduatingCurve.nativeReserve() == 0, "graduated reserve not cleared");
        require(graduatingCurve.liquidityPool() != address(0), "pool not created at exact target");
        require(graduatingCurve.lpTokenId() != 0, "lp token id not recorded at exact target");
        require(
            positionManagerMock.ownerOf(graduatingCurve.lpTokenId()) == address(1),
            "LP NFT not locked at address(1) at exact target"
        );
    }

    function testGraduatedEventEmitsCorrectPoolAndTokenId() public {
        uint256 target = 0.99 ether;
        (, HoodlumsTestBondingCurve graduatingCurve) = _deployFreshFundedCurve(target);

        vm.deal(BUYER, 2 ether);
        vm.prank(BUYER);
        graduatingCurve.buy{value: 0.5 ether}(0, DEADLINE);

        vm.recordLogs();
        vm.prank(BUYER);
        graduatingCurve.buy{value: 0.5 ether}(0, DEADLINE);
        VmLog[] memory logs = vm.getRecordedLogs();

        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(graduatingCurve)) continue;
            if (logs[i].topics.length == 0 || logs[i].topics[0] != GRADUATED_EVENT_SIGNATURE) continue;
            address emittedPool = address(uint160(uint256(logs[i].topics[1])));
            uint256 emittedTokenId = uint256(logs[i].topics[2]);
            require(emittedPool == graduatingCurve.liquidityPool(), "Graduated event pool mismatch");
            require(emittedTokenId == graduatingCurve.lpTokenId(), "Graduated event tokenId mismatch");
            found = true;
        }
        require(found, "Graduated event not emitted");
    }

    function test_RevertWhen_UniswapMintFails() public {
        FailingNonfungiblePositionManager failingManager = new FailingNonfungiblePositionManager();
        FixedSupplyMemeToken failToken = _deployToken(WHOLE_TOKEN_SUPPLY);
        uint256 target = 0.99 ether;
        HoodlumsTestBondingCurve failCurve = new HoodlumsTestBondingCurve(
            address(failToken),
            address(this),
            TREASURY,
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            target,
            address(failingManager),
            address(uniswapFactoryMock),
            address(wethMock)
        );
        failToken.approve(address(failCurve), failToken.totalSupply());
        failCurve.fundCurve();

        vm.deal(BUYER, 2 ether);
        vm.prank(BUYER);
        failCurve.buy{value: 0.5 ether}(0, DEADLINE);

        uint256 reserveBeforeFinalBuy = failCurve.nativeReserve();
        uint256 buyerTokensBeforeFinalBuy = failToken.balanceOf(BUYER);
        uint256 curveTokensBeforeFinalBuy = failCurve.tokensAvailable();
        uint256 curveBalanceBeforeFinalBuy = address(failCurve).balance;

        vm.prank(BUYER);
        vm.expectRevert();
        failCurve.buy{value: 0.5 ether}(0, DEADLINE);

        require(!failCurve.graduated(), "curve marked graduated despite failed mint");
        require(failCurve.liquidityPool() == address(0), "pool address set despite failed mint");
        require(failCurve.lpTokenId() == 0, "lp token id set despite failed mint");
        require(failCurve.nativeReserve() == reserveBeforeFinalBuy, "reserve changed despite reverted buy");
        require(failToken.balanceOf(BUYER) == buyerTokensBeforeFinalBuy, "buyer received tokens despite reverted buy");
        require(
            failCurve.tokensAvailable() == curveTokensBeforeFinalBuy,
            "curve token balance changed despite reverted buy"
        );
        require(
            address(failCurve).balance == curveBalanceBeforeFinalBuy,
            "curve native balance changed despite reverted buy"
        );
    }

    /// @dev H-1: Uniswap V3 pool creation/initialization is permissionless, so
    ///      an attacker who sees the curve nearing its graduation target can
    ///      pre-create and pre-initialize the token/WETH pool at an extreme
    ///      price. Proves the graduating buy reverts instead of depositing the
    ///      whole graduation liquidity at that price, that the curve fully
    ///      unwinds (not graduated, reserves/tokens/native balance intact),
    ///      and that once the rigged pool's price is moved back within
    ///      tolerance (simulating arbitrage self-correction) the very same
    ///      retry succeeds and graduates normally.
    function testPoolPreInitializedOutOfToleranceRevertsThenSucceedsAfterArbitrageCorrection() public {
        uint256 target = 0.99 ether;
        (FixedSupplyMemeToken riggedToken, HoodlumsTestBondingCurve riggedCurve) = _deployFreshFundedCurve(target);

        vm.deal(BUYER, 2 ether);
        vm.prank(BUYER);
        riggedCurve.buy{value: 0.5 ether}(0, DEADLINE);
        require(!riggedCurve.graduated(), "graduated before target reached");

        (,, uint256 amount0Desired, uint256 amount1Desired) =
            _predictGraduationDesiredAmounts(riggedCurve, riggedToken, 0.5 ether, target);
        uint160 desiredSqrtPriceX96 = _sqrtPriceX96(amount0Desired, amount1Desired);
        address riggedPool = _riggedPool(riggedToken, desiredSqrtPriceX96 / 10);

        uint256 reserveBeforeAttempt = riggedCurve.nativeReserve();
        uint256 tokensBeforeAttempt = riggedCurve.tokensAvailable();
        uint256 balanceBeforeAttempt = address(riggedCurve).balance;

        vm.prank(BUYER);
        vm.expectRevert();
        riggedCurve.buy{value: 0.5 ether}(0, DEADLINE);

        require(!riggedCurve.graduated(), "graduated despite out-of-tolerance rigged pool");
        require(riggedCurve.liquidityPool() == address(0), "pool recorded despite reverted graduation");
        require(riggedCurve.lpTokenId() == 0, "lp token id set despite reverted graduation");
        require(riggedCurve.nativeReserve() == reserveBeforeAttempt, "reserve changed despite revert");
        require(riggedCurve.tokensAvailable() == tokensBeforeAttempt, "curve tokens changed despite revert");
        require(address(riggedCurve).balance == balanceBeforeAttempt, "curve native balance changed despite revert");

        // Arbitrage self-corrects the rigged pool back to the curve's own ratio.
        // This is temporary protection, not a bricked state.
        MockUniswapV3Pool(riggedPool).setSqrtPriceX96(desiredSqrtPriceX96);

        vm.prank(BUYER);
        riggedCurve.buy{value: 0.5 ether}(0, DEADLINE);

        require(riggedCurve.graduated(), "curve failed to graduate after price correction");
        require(riggedCurve.liquidityPool() == riggedPool, "graduation used a different pool");
        require(riggedCurve.nativeReserve() == 0, "reserve not cleared after graduation");
    }

    function testPoolPreInitializedJustOutsideToleranceOnBothSidesRevertsWithPoolPriceOutOfTolerance() public {
        uint256 target = 0.99 ether;
        // 51 bps away from the curve's desired ratio on each side, just past
        // the 50 bps (POOL_SQRT_PRICE_TOLERANCE_BPS) tolerance.
        _assertOutOfToleranceReverts(target, 9_949);
        _assertOutOfToleranceReverts(target, 10_051);
    }

    function testPoolPreInitializedJustInsideToleranceOnBothSidesGraduates() public {
        uint256 target = 0.99 ether;
        // 49 bps away from the curve's desired ratio on each side, just
        // inside the 50 bps (POOL_SQRT_PRICE_TOLERANCE_BPS) tolerance.
        _assertWithinToleranceGraduates(target, 9_951);
        _assertWithinToleranceGraduates(target, 10_049);
    }

    /// @dev Review L-1 / mint floor: if the position manager (a mispriced
    ///      pool) would only consume less than GRADUATION_MIN_DEPOSIT_BPS of
    ///      either side, the mint's slippage floors must reject it and the
    ///      whole buy — and graduation with it — must fully unwind.
    function testGraduationMintBelowMinDepositFloorRevertsAndUnwindsCurveState() public {
        uint256 target = 0.99 ether;
        (, HoodlumsTestBondingCurve floorCurve) = _deployFreshFundedCurve(target);

        vm.deal(BUYER, 2 ether);
        vm.prank(BUYER);
        floorCurve.buy{value: 0.5 ether}(0, DEADLINE);

        positionManagerMock.setConsumptionBps(9_800); // 98% < GRADUATION_MIN_DEPOSIT_BPS (99%)

        uint256 reserveBefore = floorCurve.nativeReserve();
        uint256 tokensBefore = floorCurve.tokensAvailable();
        uint256 balanceBefore = address(floorCurve).balance;

        vm.prank(BUYER);
        vm.expectRevert();
        floorCurve.buy{value: 0.5 ether}(0, DEADLINE);

        require(!floorCurve.graduated(), "graduated despite mint below the 99% floor");
        require(floorCurve.liquidityPool() == address(0), "pool recorded despite reverted mint");
        require(floorCurve.nativeReserve() == reserveBefore, "reserve changed despite reverted mint");
        require(floorCurve.tokensAvailable() == tokensBefore, "curve tokens changed despite reverted mint");
        require(address(floorCurve).balance == balanceBefore, "curve native balance changed despite reverted mint");
    }

    /// @dev Exact boundary: a mint consuming precisely GRADUATION_MIN_DEPOSIT_BPS
    ///      (99%) of both sides must succeed, since the floor check is `>=`.
    function testGraduationMintAtExactMinDepositFloorSucceeds() public {
        uint256 target = 0.99 ether;
        (, HoodlumsTestBondingCurve floorCurve) = _deployFreshFundedCurve(target);

        vm.deal(BUYER, 2 ether);
        vm.prank(BUYER);
        floorCurve.buy{value: 0.5 ether}(0, DEADLINE);

        positionManagerMock.setConsumptionBps(9_900); // == GRADUATION_MIN_DEPOSIT_BPS

        vm.prank(BUYER);
        floorCurve.buy{value: 0.5 ether}(0, DEADLINE);

        require(floorCurve.graduated(), "curve failed to graduate at the exact 99% floor");
    }

    /// @dev Review L-1: dust left over after a mint that clears the floor but
    ///      doesn't consume 100% must be swept, never stranded — leftover
    ///      token burned, leftover WETH unwrapped and accrued through the
    ///      same 60/40 treasury/creator fee split every trading fee already
    ///      uses. Asserts exact balances, not just "some amount moved".
    function testGraduationMintAboveFloorSweepsLeftoverWithExactBalances() public {
        uint256 target = 0.99 ether;
        (FixedSupplyMemeToken dustToken, HoodlumsTestBondingCurve dustCurve) = _deployFreshFundedCurve(target);
        FeeAccrual memory acc;

        vm.deal(BUYER, 2 ether);

        _accrueExpectedFee(acc, dustCurve.quoteBuyFee(0.5 ether));
        vm.prank(BUYER);
        dustCurve.buy{value: 0.5 ether}(0, DEADLINE);

        positionManagerMock.setConsumptionBps(9_950); // 99.5%: clears the floor, still leaves dust

        GraduationDust memory dust = _predictGraduationDust(dustCurve, dustToken, 0.5 ether, target, 9_950);
        require(dust.leftoverToken > 0 && dust.leftoverWeth > 0, "test setup produced no dust");

        // The trading fee on the graduating buy accrues first (inside buy()),
        // then the dust sweep accrues on top of it (inside _graduate()), so
        // the carry must be threaded through in that same order.
        _accrueExpectedFee(acc, dustCurve.quoteBuyFee(0.5 ether));
        _accrueExpectedFee(acc, dust.leftoverWeth);

        uint256 supplyBeforeGraduation = dustToken.totalSupply();

        vm.recordLogs();
        vm.prank(BUYER);
        dustCurve.buy{value: 0.5 ether}(0, DEADLINE);
        VmLog[] memory logs = vm.getRecordedLogs();

        require(dustCurve.graduated(), "curve failed to graduate with dust-producing consumption");
        require(dustToken.balanceOf(address(dustCurve)) == 0, "leftover token not fully burned");
        require(wethMock.balanceOf(address(dustCurve)) == 0, "leftover weth not fully unwrapped");
        require(
            dustToken.totalSupply() == supplyBeforeGraduation - dust.leftoverToken,
            "burned leftover amount mismatch"
        );
        require(dustCurve.treasuryFeeBalance() == acc.treasury, "treasury balance after sweep wrong");
        require(dustCurve.creatorFeeBalance() == acc.creator, "creator balance after sweep wrong");
        require(dustCurve.totalFeesAccrued() == acc.total, "total fees accrued after sweep wrong");
        require(
            dustCurve.treasuryFeeBalance() + dustCurve.creatorFeeBalance() == dustCurve.totalFeesAccrued(),
            "60/40 split lost wei after dust sweep"
        );

        _assertDustEventEmitted(logs, address(dustCurve), dust.leftoverToken, dust.leftoverWeth);
    }

    /// @dev Mutates `acc` in place: Solidity passes memory structs by
    ///      reference to internal functions within the same call.
    function _accrueExpectedFee(FeeAccrual memory acc, uint256 fee) internal pure {
        if (fee == 0) return;
        uint256 scaled = fee * PROTOCOL_FEE_SHARE_BPS + acc.carry;
        uint256 treasuryShare = scaled / BPS;
        acc.carry = scaled % BPS;
        acc.treasury += treasuryShare;
        acc.creator += fee - treasuryShare;
        acc.total += fee;
    }

    function _predictGraduationDust(
        HoodlumsTestBondingCurve targetCurve,
        FixedSupplyMemeToken targetToken,
        uint256 finalBuyGross,
        uint256 target,
        uint256 consumptionBps
    ) internal view returns (GraduationDust memory dust) {
        (,, uint256 amount0Desired, uint256 amount1Desired) =
            _predictGraduationDesiredAmounts(targetCurve, targetToken, finalBuyGross, target);
        uint256 amount0Consumed = (amount0Desired * consumptionBps) / BPS;
        uint256 amount1Consumed = (amount1Desired * consumptionBps) / BPS;
        bool tokenIsToken0 = address(targetToken) < address(wethMock);
        dust.leftoverToken = tokenIsToken0 ? amount0Desired - amount0Consumed : amount1Desired - amount1Consumed;
        dust.leftoverWeth = tokenIsToken0 ? amount1Desired - amount1Consumed : amount0Desired - amount0Consumed;
    }

    function _assertDustEventEmitted(
        VmLog[] memory logs,
        address emitter,
        uint256 expectedToken,
        uint256 expectedWeth
    ) internal pure {
        bytes32 dustEventSignature = keccak256("GraduationDustSwept(uint256,uint256)");
        bool foundDustEvent;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != emitter) continue;
            if (logs[i].topics.length == 0 || logs[i].topics[0] != dustEventSignature) continue;
            (uint256 tokenBurned, uint256 nativeAccrued) = abi.decode(logs[i].data, (uint256, uint256));
            require(tokenBurned == expectedToken, "dust event token amount wrong");
            require(nativeAccrued == expectedWeth, "dust event native amount wrong");
            foundDustEvent = true;
        }
        require(foundDustEvent, "GraduationDustSwept event not emitted");
    }

    function _assertOutOfToleranceReverts(uint256 target, uint256 riggedBps) internal {
        (FixedSupplyMemeToken riggedToken, HoodlumsTestBondingCurve riggedCurve) = _deployFreshFundedCurve(target);

        vm.deal(BUYER, 2 ether);
        vm.prank(BUYER);
        riggedCurve.buy{value: 0.5 ether}(0, DEADLINE);

        (,, uint256 amount0Desired, uint256 amount1Desired) =
            _predictGraduationDesiredAmounts(riggedCurve, riggedToken, 0.5 ether, target);
        uint160 desiredSqrtPriceX96 = _sqrtPriceX96(amount0Desired, amount1Desired);
        uint160 riggedSqrtPriceX96 = uint160(Math.mulDiv(uint256(desiredSqrtPriceX96), riggedBps, BPS));
        _riggedPool(riggedToken, riggedSqrtPriceX96);

        vm.prank(BUYER);
        (bool ok, bytes memory returndata) = address(riggedCurve).call{value: 0.5 ether}(
            abi.encodeCall(HoodlumsTestBondingCurve.buy, (0, DEADLINE))
        );
        require(!ok, "buy succeeded despite out-of-tolerance rigged pool");
        require(
            _revertedWithSelector(returndata, HoodlumsTestBondingCurve.PoolPriceOutOfTolerance.selector),
            "wrong revert reason for out-of-tolerance pool"
        );
        require(!riggedCurve.graduated(), "graduated despite out-of-tolerance rigged pool");
    }

    function _assertWithinToleranceGraduates(uint256 target, uint256 riggedBps) internal {
        (FixedSupplyMemeToken riggedToken, HoodlumsTestBondingCurve riggedCurve) = _deployFreshFundedCurve(target);

        vm.deal(BUYER, 2 ether);
        vm.prank(BUYER);
        riggedCurve.buy{value: 0.5 ether}(0, DEADLINE);

        (,, uint256 amount0Desired, uint256 amount1Desired) =
            _predictGraduationDesiredAmounts(riggedCurve, riggedToken, 0.5 ether, target);
        uint160 desiredSqrtPriceX96 = _sqrtPriceX96(amount0Desired, amount1Desired);
        uint160 riggedSqrtPriceX96 = uint160(Math.mulDiv(uint256(desiredSqrtPriceX96), riggedBps, BPS));
        address riggedPool = _riggedPool(riggedToken, riggedSqrtPriceX96);

        vm.prank(BUYER);
        riggedCurve.buy{value: 0.5 ether}(0, DEADLINE);

        require(riggedCurve.graduated(), "curve failed to graduate with in-tolerance rigged pool");
        require(riggedCurve.liquidityPool() == riggedPool, "graduation used a different pool");
    }

    /// @dev Mirrors HoodlumsTestBondingCurve's own `_initialSqrtPriceX96` so
    ///      tests can predict and rig prices against the exact same math.
    function _sqrtPriceX96(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        uint256 ratioX192 = Math.mulDiv(amount1, uint256(1) << 192, amount0);
        return SafeCast.toUint160(Math.sqrt(ratioX192));
    }

    /// @dev Predicts the token0/token1 ordering and desired mint amounts
    ///      `_graduate()` will use for the buy that brings `targetCurve` from
    ///      its current reserve to `target`, without needing to duplicate the
    ///      curve's quoting formula: `finalBuyGross` must be the exact gross
    ///      input that buy already relies on elsewhere to land exactly on
    ///      `target` (this file's tests always use two 0.5 ether buys against
    ///      a 0.99 ether target for that reason).
    function _predictGraduationDesiredAmounts(
        HoodlumsTestBondingCurve targetCurve,
        FixedSupplyMemeToken targetToken,
        uint256 finalBuyGross,
        uint256 target
    ) internal view returns (address token0, address token1, uint256 amount0Desired, uint256 amount1Desired) {
        uint256 tokenLiquidity = targetCurve.tokensAvailable() - targetCurve.quoteBuy(finalBuyGross);
        uint256 nativeLiquidity = target;
        bool tokenIsToken0 = address(targetToken) < address(wethMock);
        token0 = tokenIsToken0 ? address(targetToken) : address(wethMock);
        token1 = tokenIsToken0 ? address(wethMock) : address(targetToken);
        amount0Desired = tokenIsToken0 ? tokenLiquidity : nativeLiquidity;
        amount1Desired = tokenIsToken0 ? nativeLiquidity : tokenLiquidity;
    }

    /// @dev Pre-creates and pre-initializes the token/WETH pool the way a
    ///      permissionless attacker could, ahead of the curve's own
    ///      graduation call.
    function _riggedPool(FixedSupplyMemeToken targetToken, uint160 sqrtPriceX96) internal returns (address pool) {
        pool = uniswapFactoryMock.createPool(address(targetToken), address(wethMock), 10_000);
        MockUniswapV3Pool(pool).initialize(sqrtPriceX96);
    }

    function _revertedWithSelector(bytes memory returndata, bytes4 expectedSelector) internal pure returns (bool) {
        if (returndata.length < 4) return false;
        bytes4 selector;
        assembly {
            selector := mload(add(returndata, 32))
        }
        return selector == expectedSelector;
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
            DEFAULT_GRADUATION_TARGET,
            address(positionManagerMock),
            address(uniswapFactoryMock),
            address(wethMock)
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
            target,
            address(positionManagerMock),
            address(uniswapFactoryMock),
            address(wethMock)
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

    /// @dev `_tradingFee` rounds up, so `net(gross) = gross - fee(gross)` is
    ///      not always exactly invertible by a single formula. `net` is
    ///      non-decreasing in `gross` and never jumps by more than 1 per unit
    ///      of `gross`, so binary-searching against the curve's own (pure)
    ///      `quoteBuyFee` for the smallest `gross` with `net(gross) >=
    ///      desiredNet` always lands exactly on `desiredNet`, without this
    ///      test needing to duplicate or guess at the fee-rounding formula.
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

    receive() external payable {}
}

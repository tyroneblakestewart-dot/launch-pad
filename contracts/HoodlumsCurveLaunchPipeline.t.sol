// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FixedSupplyMemeToken} from "./FixedSupplyMemeToken.sol";
import {HoodlumsTestBondingCurve} from "./HoodlumsTestBondingCurve.sol";
import {HoodlumsCurveLaunchPipeline} from "./HoodlumsCurveLaunchPipeline.sol";
import {
    MockWETH9,
    MockUniswapV3Factory,
    MockNonfungiblePositionManager
} from "./mocks/UniswapV3Mocks.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function prank(address nextCaller) external;
}

contract HoodlumsCurveLaunchPipelineTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant CREATOR = address(0xC0FFEE);
    address private constant TREASURY = address(0x7EA5);
    uint256 private constant WHOLE_TOKEN_SUPPLY = 1_000_000;
    uint256 private constant VIRTUAL_TOKEN_RESERVE = 1_000_000 ether;
    uint256 private constant VIRTUAL_ETH_RESERVE = 1 ether;
    uint256 private constant GRADUATION_TARGET = 4 ether;
    uint256 private constant DEADLINE = type(uint256).max;

    MockWETH9 private wethMock;
    MockUniswapV3Factory private uniswapFactoryMock;
    MockNonfungiblePositionManager private positionManagerMock;
    HoodlumsCurveLaunchPipeline private pipeline;

    function setUp() public {
        wethMock = new MockWETH9();
        uniswapFactoryMock = new MockUniswapV3Factory();
        positionManagerMock = new MockNonfungiblePositionManager();
        pipeline = new HoodlumsCurveLaunchPipeline(
            TREASURY,
            address(positionManagerMock),
            address(uniswapFactoryMock),
            address(wethMock)
        );
    }

    function testConstructorRejectsAnyZeroAddress() public {
        (bool zeroTreasury,) = address(this).call(
            abi.encodeCall(
                HoodlumsCurveLaunchPipelineTest._deployPipeline,
                (address(0), address(positionManagerMock), address(uniswapFactoryMock), address(wethMock))
            )
        );
        require(!zeroTreasury, "zero treasury accepted");

        (bool zeroPositionManager,) = address(this).call(
            abi.encodeCall(
                HoodlumsCurveLaunchPipelineTest._deployPipeline,
                (TREASURY, address(0), address(uniswapFactoryMock), address(wethMock))
            )
        );
        require(!zeroPositionManager, "zero position manager accepted");

        (bool zeroFactory,) = address(this).call(
            abi.encodeCall(
                HoodlumsCurveLaunchPipelineTest._deployPipeline,
                (TREASURY, address(positionManagerMock), address(0), address(wethMock))
            )
        );
        require(!zeroFactory, "zero uniswap factory accepted");

        (bool zeroWeth,) = address(this).call(
            abi.encodeCall(
                HoodlumsCurveLaunchPipelineTest._deployPipeline,
                (TREASURY, address(positionManagerMock), address(uniswapFactoryMock), address(0))
            )
        );
        require(!zeroWeth, "zero weth9 accepted");
    }

    function _deployPipeline(
        address treasury_,
        address positionManager_,
        address uniswapV3Factory_,
        address weth9_
    ) external returns (HoodlumsCurveLaunchPipeline) {
        return new HoodlumsCurveLaunchPipeline(treasury_, positionManager_, uniswapV3Factory_, weth9_);
    }

    function testLaunchDeploysTokenAndCurveOwnedByTheRealCaller() public {
        vm.prank(CREATOR);
        (address token, address curve) = pipeline.launchTokenWithCurve(
            "Pipeline Token",
            "PIPE",
            WHOLE_TOKEN_SUPPLY,
            18,
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            GRADUATION_TARGET
        );

        FixedSupplyMemeToken deployedToken = FixedSupplyMemeToken(token);
        require(keccak256(bytes(deployedToken.name())) == keccak256(bytes("Pipeline Token")), "wrong name");
        require(deployedToken.totalSupply() == WHOLE_TOKEN_SUPPLY * 1 ether, "wrong supply");
        require(deployedToken.balanceOf(CREATOR) == WHOLE_TOKEN_SUPPLY * 1 ether, "creator missing supply");
        require(deployedToken.balanceOf(address(pipeline)) == 0, "pipeline retained tokens");

        HoodlumsTestBondingCurve deployedCurve = HoodlumsTestBondingCurve(payable(curve));
        require(address(deployedCurve.token()) == token, "curve wired to wrong token");
        require(deployedCurve.creator() == CREATOR, "curve creator is not the real caller");
        require(deployedCurve.treasury() == TREASURY, "wrong treasury");
        require(deployedCurve.graduationTarget() == GRADUATION_TARGET, "wrong graduation target");
        require(!deployedCurve.funded(), "curve should not be funded yet");
    }

    /// @dev Proves the full three-signature flow this contract exists to
    ///      shorten (launch, approve, fundCurve) actually reaches a tradeable
    ///      curve, and that a subsequent buy still enforces the graduation
    ///      clamp exactly as it does for any other curve.
    function testFullFlowFundsCurveAndAllowsTrading() public {
        vm.deal(CREATOR, 10 ether);

        vm.prank(CREATOR);
        (address token, address curve) = pipeline.launchTokenWithCurve(
            "Pipeline Token",
            "PIPE",
            WHOLE_TOKEN_SUPPLY,
            18,
            VIRTUAL_TOKEN_RESERVE,
            VIRTUAL_ETH_RESERVE,
            GRADUATION_TARGET
        );

        FixedSupplyMemeToken deployedToken = FixedSupplyMemeToken(token);
        HoodlumsTestBondingCurve deployedCurve = HoodlumsTestBondingCurve(payable(curve));

        uint256 fullSupply = deployedToken.totalSupply();
        vm.prank(CREATOR);
        deployedToken.approve(curve, fullSupply);

        vm.prank(CREATOR);
        deployedCurve.fundCurve();
        require(deployedCurve.funded(), "curve not funded after real flow");
        require(deployedCurve.curveTokenSupply() == fullSupply, "curve underfunded");

        vm.prank(CREATOR);
        uint256 tokensOut = deployedCurve.buy{value: 1 ether}(0, DEADLINE);
        require(tokensOut > 0, "buy produced no tokens");
        require(deployedCurve.realNativeReserve() > 0, "buy did not count toward graduation");
        require(
            deployedCurve.remainingNativeToGraduate() == GRADUATION_TARGET - deployedCurve.realNativeReserve(),
            "wrong remaining-to-graduate"
        );

        uint256 remaining = deployedCurve.remainingNativeToGraduate();
        uint256 exactGross = _grossNeededForExactNet(deployedCurve, remaining);
        vm.deal(CREATOR, exactGross + 1 ether);

        vm.prank(CREATOR);
        (bool overGraduation,) = curve.call{value: exactGross + 1 ether}(
            abi.encodeCall(HoodlumsTestBondingCurve.buy, (0, DEADLINE))
        );
        require(!overGraduation, "buy above remaining-to-graduate should revert");

        vm.prank(CREATOR);
        deployedCurve.buy{value: exactGross}(0, DEADLINE);
        require(deployedCurve.graduated(), "curve did not graduate at target");
    }

    /// @dev Binary search for the smallest gross native input whose post-fee
    ///      net exactly equals `desiredNet`, mirroring
    ///      HoodlumsTestBondingCurve.t.sol's `_grossNeededForExactNet` helper
    ///      so this suite doesn't have to duplicate or guess at the curve's
    ///      fee-rounding formula.
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

    function testPipelineNeverHoldsTokensAcrossLaunches() public {
        vm.prank(CREATOR);
        (address firstToken,) = pipeline.launchTokenWithCurve(
            "First", "ONE", WHOLE_TOKEN_SUPPLY, 18, VIRTUAL_TOKEN_RESERVE, VIRTUAL_ETH_RESERVE, GRADUATION_TARGET
        );
        address otherCreator = address(0xD00D);
        vm.prank(otherCreator);
        (address secondToken,) = pipeline.launchTokenWithCurve(
            "Second", "TWO", WHOLE_TOKEN_SUPPLY, 18, VIRTUAL_TOKEN_RESERVE, VIRTUAL_ETH_RESERVE, GRADUATION_TARGET
        );

        require(firstToken != secondToken, "token addresses collided");
        require(FixedSupplyMemeToken(firstToken).balanceOf(address(pipeline)) == 0, "pipeline holds first token");
        require(FixedSupplyMemeToken(secondToken).balanceOf(address(pipeline)) == 0, "pipeline holds second token");
        require(FixedSupplyMemeToken(secondToken).balanceOf(otherCreator) == WHOLE_TOKEN_SUPPLY * 1 ether, "wrong recipient");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HoodlumsTestLiquidityPool} from "./HoodlumsTestLiquidityPool.sol";

/// @notice Testnet-only virtual-reserve bonding curve for a fixed-supply ERC-20.
/// @dev This contract has no platform or creator trading fees. Fee policy and
///      production economics require a separate owner decision and audit.
contract HoodlumsTestBondingCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    address public constant LP_LOCK_ADDRESS = address(1);

    IERC20 public immutable token;
    address public immutable creator;
    uint256 public immutable initialVirtualTokenReserve;
    uint256 public immutable initialVirtualEthReserve;
    uint256 public immutable graduationTarget;

    uint256 public virtualTokenReserve;
    uint256 public virtualEthReserve;
    uint256 public curveTokenSupply;

    bool public funded;
    bool public graduated;
    address public liquidityPool;

    error InvalidAddress();
    error InvalidConfiguration();
    error OnlyCreator();
    error AlreadyFunded();
    error NotFunded();
    error AlreadyGraduated();
    error GraduationTargetNotReached();
    error ZeroInput();
    error Expired();
    error SlippageExceeded();
    error InsufficientCurveTokens();
    error InsufficientNativeReserve();
    error UnsupportedTokenTransfer();
    error NativeTransferFailed();
    error LiquidityLockFailed();
    error DirectPaymentNotAccepted();

    event CurveFunded(address indexed creator, uint256 tokenAmount);
    event TokensPurchased(
        address indexed buyer,
        uint256 nativeIn,
        uint256 tokensOut,
        uint256 virtualTokenReserve,
        uint256 virtualEthReserve
    );
    event TokensSold(
        address indexed seller,
        uint256 tokensIn,
        uint256 nativeOut,
        uint256 virtualTokenReserve,
        uint256 virtualEthReserve
    );
    event CurveGraduated(
        address indexed pool,
        uint256 tokenLiquidity,
        uint256 nativeLiquidity,
        uint256 lpLocked
    );

    modifier onlyCreator() {
        if (msg.sender != creator) revert OnlyCreator();
        _;
    }

    modifier tradingOpen() {
        if (!funded) revert NotFunded();
        if (graduated) revert AlreadyGraduated();
        _;
    }

    modifier beforeDeadline(uint256 deadline) {
        if (deadline < block.timestamp) revert Expired();
        _;
    }

    constructor(
        address token_,
        address creator_,
        uint256 virtualTokenReserve_,
        uint256 virtualEthReserve_,
        uint256 graduationTarget_
    ) {
        if (token_ == address(0) || creator_ == address(0)) revert InvalidAddress();
        if (virtualTokenReserve_ == 0 || virtualEthReserve_ == 0 || graduationTarget_ == 0) {
            revert InvalidConfiguration();
        }

        token = IERC20(token_);
        creator = creator_;
        initialVirtualTokenReserve = virtualTokenReserve_;
        initialVirtualEthReserve = virtualEthReserve_;
        graduationTarget = graduationTarget_;
        virtualTokenReserve = virtualTokenReserve_;
        virtualEthReserve = virtualEthReserve_;
    }

    /// @notice Fund the curve once after the creator has approved this contract.
    function fundCurve(uint256 tokenAmount) external onlyCreator nonReentrant {
        if (funded) revert AlreadyFunded();
        if (tokenAmount == 0) revert ZeroInput();

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), tokenAmount);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != tokenAmount) revert UnsupportedTokenTransfer();

        curveTokenSupply = tokenAmount;
        funded = true;
        emit CurveFunded(msg.sender, tokenAmount);
    }

    /// @notice Buy curve tokens with native testnet currency.
    function buy(uint256 minTokensOut, uint256 deadline)
        external
        payable
        nonReentrant
        tradingOpen
        beforeDeadline(deadline)
        returns (uint256 tokensOut)
    {
        if (msg.value == 0) revert ZeroInput();

        tokensOut = quoteBuy(msg.value);
        if (tokensOut == 0 || tokensOut < minTokensOut) revert SlippageExceeded();
        if (tokensOut > token.balanceOf(address(this))) revert InsufficientCurveTokens();

        virtualEthReserve += msg.value;
        virtualTokenReserve -= tokensOut;
        token.safeTransfer(msg.sender, tokensOut);

        emit TokensPurchased(
            msg.sender,
            msg.value,
            tokensOut,
            virtualTokenReserve,
            virtualEthReserve
        );

        if (address(this).balance >= graduationTarget) {
            _graduate();
        }
    }

    /// @notice Sell curve tokens back for native testnet currency.
    function sell(uint256 tokensIn, uint256 minNativeOut, uint256 deadline)
        external
        nonReentrant
        tradingOpen
        beforeDeadline(deadline)
        returns (uint256 nativeOut)
    {
        if (tokensIn == 0) revert ZeroInput();

        nativeOut = quoteSell(tokensIn);
        if (nativeOut == 0 || nativeOut < minNativeOut) revert SlippageExceeded();
        if (nativeOut > address(this).balance) revert InsufficientNativeReserve();

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), tokensIn);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != tokensIn) revert UnsupportedTokenTransfer();

        virtualTokenReserve += tokensIn;
        virtualEthReserve -= nativeOut;
        _safeTransferNative(msg.sender, nativeOut);

        emit TokensSold(
            msg.sender,
            tokensIn,
            nativeOut,
            virtualTokenReserve,
            virtualEthReserve
        );
    }

    /// @notice Permissionless fallback graduation once the target is met.
    function graduate() external nonReentrant tradingOpen {
        if (address(this).balance < graduationTarget) revert GraduationTargetNotReached();
        _graduate();
    }

    function quoteBuy(uint256 nativeIn) public view returns (uint256 tokensOut) {
        if (nativeIn == 0) return 0;
        tokensOut = Math.mulDiv(
            nativeIn,
            virtualTokenReserve,
            virtualEthReserve + nativeIn
        );
    }

    function quoteSell(uint256 tokensIn) public view returns (uint256 nativeOut) {
        if (tokensIn == 0) return 0;
        nativeOut = Math.mulDiv(
            tokensIn,
            virtualEthReserve,
            virtualTokenReserve + tokensIn
        );
    }

    function nativeReserve() external view returns (uint256) {
        return address(this).balance;
    }

    function tokensAvailable() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function graduationProgressBps() external view returns (uint256) {
        uint256 reserve = address(this).balance;
        if (reserve >= graduationTarget) return BPS;
        return Math.mulDiv(reserve, BPS, graduationTarget);
    }

    function _graduate() internal {
        uint256 tokenLiquidity = token.balanceOf(address(this));
        uint256 nativeLiquidity = address(this).balance;
        if (tokenLiquidity == 0 || nativeLiquidity == 0) revert InvalidConfiguration();

        graduated = true;

        HoodlumsTestLiquidityPool pool = new HoodlumsTestLiquidityPool(address(token));
        liquidityPool = address(pool);

        token.forceApprove(address(pool), tokenLiquidity);
        pool.addLiquidity{value: nativeLiquidity}(
            tokenLiquidity,
            tokenLiquidity,
            nativeLiquidity,
            0,
            block.timestamp
        );
        token.forceApprove(address(pool), 0);

        uint256 lpLocked = pool.balanceOf(address(this));
        if (lpLocked == 0 || !pool.transfer(LP_LOCK_ADDRESS, lpLocked)) {
            revert LiquidityLockFailed();
        }

        emit CurveGraduated(address(pool), tokenLiquidity, nativeLiquidity, lpLocked);
    }

    function _safeTransferNative(address to, uint256 amount) internal {
        (bool sent,) = payable(to).call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
    }

    receive() external payable {
        revert DirectPaymentNotAccepted();
    }
}

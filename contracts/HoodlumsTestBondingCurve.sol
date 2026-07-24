// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {HoodlumsTestLiquidityPool} from "./HoodlumsTestLiquidityPool.sol";

/// @notice Testnet-only virtual-reserve bonding curve for a fixed-supply ERC-20.
/// @dev The complete current token supply must enter the curve before trading.
///      This prevents an unlocked creator allocation from being sold into buyers.
///      A fixed 1% trading fee (60% protocol treasury / 40% creator) applies to
///      every buy and sell. Fees are pull payments only: trades accrue claimable
///      balances and never push native currency to the treasury or creator, so a
///      reverting recipient cannot block trading, graduation, or the other
///      recipient's withdrawal. Fee balances are excluded from graduation
///      liquidity — `_graduate()` seeds the pool from `realNativeReserve` only.
contract HoodlumsTestBondingCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant TRADING_FEE_BPS = 100;
    uint256 public constant PROTOCOL_FEE_SHARE_BPS = 6_000;
    uint256 public constant CREATOR_FEE_SHARE_BPS = 4_000;
    uint256 public constant POOL_MINIMUM_LIQUIDITY_SQUARED = 1_002_001;
    address public constant LP_LOCK_ADDRESS = address(1);

    IERC20 public immutable token;
    address public immutable creator;
    address public immutable treasury;
    uint256 public immutable initialVirtualTokenReserve;
    uint256 public immutable initialVirtualEthReserve;
    uint256 public immutable graduationTarget;

    uint256 public virtualTokenReserve;
    uint256 public virtualEthReserve;
    uint256 public curveTokenSupply;
    uint256 public realNativeReserve;

    /// @notice Claimable native-currency fee balances, accrued as pull payments.
    uint256 public treasuryFeeBalance;
    uint256 public creatorFeeBalance;

    /// @dev Carried remainder (in fee-wei * PROTOCOL_FEE_SHARE_BPS units) so the
    ///      60/40 split converges exactly across many trades instead of losing
    ///      or double-counting wei to rounding.
    uint256 private treasuryShareRemainder;

    bool public funded;
    bool public graduated;
    address public liquidityPool;

    error InvalidAddress();
    error InvalidConfiguration();
    error FullSupplyRequired(uint256 required, uint256 creatorBalance);
    error InsufficientCurveFunding(uint256 required, uint256 available);
    error BuyExceedsGraduationTarget(uint256 remaining, uint256 received);
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
    error NotFeeRecipient();
    error NoFeesToWithdraw();

    event CurveFunded(address indexed creator, uint256 tokenAmount);
    event TokensPurchased(
        address indexed buyer,
        uint256 grossNativeIn,
        uint256 feeAmount,
        uint256 tokensOut,
        uint256 virtualTokenReserve,
        uint256 virtualEthReserve
    );
    event TokensSold(
        address indexed seller,
        uint256 tokensIn,
        uint256 grossNativeOut,
        uint256 feeAmount,
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
    event FeeAccrued(
        address indexed payer,
        uint256 feeAmount,
        uint256 treasuryShare,
        uint256 creatorShare
    );
    event FeeWithdrawn(address indexed recipient, uint256 amount);

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
        address treasury_,
        uint256 virtualTokenReserve_,
        uint256 virtualEthReserve_,
        uint256 graduationTarget_
    ) {
        if (token_ == address(0) || creator_ == address(0) || treasury_ == address(0)) {
            revert InvalidAddress();
        }
        if (
            virtualTokenReserve_ == 0 ||
            virtualEthReserve_ == 0 ||
            graduationTarget_ == 0 ||
            virtualEthReserve_ > type(uint256).max - graduationTarget_
        ) {
            revert InvalidConfiguration();
        }

        token = IERC20(token_);
        creator = creator_;
        treasury = treasury_;
        initialVirtualTokenReserve = virtualTokenReserve_;
        initialVirtualEthReserve = virtualEthReserve_;
        graduationTarget = graduationTarget_;
        virtualTokenReserve = virtualTokenReserve_;
        virtualEthReserve = virtualEthReserve_;
    }

    /// @notice Fund the curve once with the token's complete current supply.
    /// @dev The creator must hold and approve totalSupply(). Trading cannot open
    ///      while any token remains in another wallet.
    function fundCurve() external onlyCreator nonReentrant {
        if (funded) revert AlreadyFunded();

        uint256 fullSupply = token.totalSupply();
        if (fullSupply == 0) revert ZeroInput();

        uint256 creatorBalance = token.balanceOf(msg.sender);
        if (creatorBalance != fullSupply) {
            revert FullSupplyRequired(fullSupply, creatorBalance);
        }

        uint256 requiredFunding = minimumCurveFunding();
        if (fullSupply < requiredFunding) {
            revert InsufficientCurveFunding(requiredFunding, fullSupply);
        }

        uint256 balanceBefore = token.balanceOf(address(this));
        if (balanceBefore != 0) revert InvalidConfiguration();

        token.safeTransferFrom(msg.sender, address(this), fullSupply);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != fullSupply) revert UnsupportedTokenTransfer();

        curveTokenSupply = fullSupply;
        funded = true;
        emit CurveFunded(msg.sender, fullSupply);
    }

    /// @notice Buy curve tokens with native testnet currency.
    /// @dev `msg.value` is the gross input. A 1% fee is charged on the gross
    ///      amount (rounded up, so it can never round to zero on a nonzero
    ///      input) and accrued as a claimable balance. Only the post-fee
    ///      amount is used for the curve quote and counted toward
    ///      `realNativeReserve` / graduation.
    function buy(uint256 minTokensOut, uint256 deadline)
        external
        payable
        nonReentrant
        tradingOpen
        beforeDeadline(deadline)
        returns (uint256 tokensOut)
    {
        if (msg.value == 0) revert ZeroInput();

        uint256 feeAmount = _tradingFee(msg.value);
        uint256 netNativeIn = msg.value - feeAmount;
        if (netNativeIn == 0) revert ZeroInput();

        uint256 remainingToGraduate = graduationTarget - realNativeReserve;
        if (netNativeIn > remainingToGraduate) {
            revert BuyExceedsGraduationTarget(remainingToGraduate, netNativeIn);
        }

        tokensOut = quoteBuy(msg.value);
        if (tokensOut == 0 || tokensOut < minTokensOut) revert SlippageExceeded();
        if (tokensOut > token.balanceOf(address(this))) revert InsufficientCurveTokens();

        virtualEthReserve += netNativeIn;
        virtualTokenReserve -= tokensOut;
        realNativeReserve += netNativeIn;
        token.safeTransfer(msg.sender, tokensOut);

        (uint256 treasuryShare, uint256 creatorShare) = _accrueFee(feeAmount);

        emit TokensPurchased(
            msg.sender,
            msg.value,
            feeAmount,
            tokensOut,
            virtualTokenReserve,
            virtualEthReserve
        );
        emit FeeAccrued(msg.sender, feeAmount, treasuryShare, creatorShare);

        if (realNativeReserve == graduationTarget) {
            _graduate();
        }
    }

    /// @notice Sell curve tokens back for native testnet currency.
    /// @dev The curve's gross native output is computed first. A 1% fee is
    ///      charged on that gross output (rounded up) and accrued as a
    ///      claimable balance; the seller receives the post-fee amount. Both
    ///      virtual and real reserves drop by the full gross output, since the
    ///      fee wei remains in the contract balance (now earmarked as a fee
    ///      liability) rather than leaving with the seller.
    function sell(uint256 tokensIn, uint256 minNativeOut, uint256 deadline)
        external
        nonReentrant
        tradingOpen
        beforeDeadline(deadline)
        returns (uint256 nativeOut)
    {
        if (tokensIn == 0) revert ZeroInput();

        uint256 grossNativeOut = _quoteSellGross(tokensIn);
        uint256 feeAmount = _tradingFee(grossNativeOut);
        nativeOut = grossNativeOut - feeAmount;
        if (nativeOut == 0 || nativeOut < minNativeOut) revert SlippageExceeded();
        if (grossNativeOut > realNativeReserve) revert InsufficientNativeReserve();

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), tokensIn);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != tokensIn) revert UnsupportedTokenTransfer();

        virtualTokenReserve += tokensIn;
        virtualEthReserve -= grossNativeOut;
        realNativeReserve -= grossNativeOut;
        _safeTransferNative(msg.sender, nativeOut);

        (uint256 treasuryShare, uint256 creatorShare) = _accrueFee(feeAmount);

        emit TokensSold(
            msg.sender,
            tokensIn,
            grossNativeOut,
            feeAmount,
            nativeOut,
            virtualTokenReserve,
            virtualEthReserve
        );
        emit FeeAccrued(msg.sender, feeAmount, treasuryShare, creatorShare);
    }

    /// @notice Permissionless fallback graduation once the target is met.
    function graduate() external nonReentrant tradingOpen {
        if (realNativeReserve < graduationTarget) revert GraduationTargetNotReached();
        _graduate();
    }

    /// @notice Claim your accrued fee balance(s).
    /// @dev Pull payment with checks-effects-interactions. If `treasury` and
    ///      `creator` are the same address, that address receives the sum of
    ///      both balances in a single call and both are zeroed exactly once.
    ///      A reverting recipient only blocks its own withdrawal, never the
    ///      other recipient's, and never trading or graduation.
    function withdrawFees() external nonReentrant returns (uint256 amount) {
        bool isTreasury = msg.sender == treasury;
        bool isCreator = msg.sender == creator;
        if (!isTreasury && !isCreator) revert NotFeeRecipient();

        if (isTreasury) {
            amount += treasuryFeeBalance;
            treasuryFeeBalance = 0;
        }
        if (isCreator) {
            amount += creatorFeeBalance;
            creatorFeeBalance = 0;
        }
        if (amount == 0) revert NoFeesToWithdraw();

        _safeTransferNative(msg.sender, amount);
        emit FeeWithdrawn(msg.sender, amount);
    }

    /// @notice Claimable native-currency fee balance for `account`.
    /// @dev If `account` is both `treasury` and `creator`, returns the sum of
    ///      both balances (matching `withdrawFees()` semantics).
    function claimableFees(address account) external view returns (uint256 amount) {
        if (account == treasury) amount += treasuryFeeBalance;
        if (account == creator) amount += creatorFeeBalance;
    }

    /// @notice Total outstanding fee liability (treasury + creator), for auditability.
    function totalClaimableFees() external view returns (uint256) {
        return treasuryFeeBalance + creatorFeeBalance;
    }

    /// @notice Net tokens received for a gross native input, after the 1% trading fee.
    function quoteBuy(uint256 grossNativeIn) public view returns (uint256 tokensOut) {
        if (grossNativeIn == 0) return 0;
        uint256 fee = _tradingFee(grossNativeIn);
        uint256 netNativeIn = grossNativeIn - fee;
        if (netNativeIn == 0) return 0;
        tokensOut = Math.mulDiv(
            netNativeIn,
            virtualTokenReserve,
            virtualEthReserve + netNativeIn
        );
    }

    /// @notice Fee charged on a gross buy input of `grossNativeIn`.
    function quoteBuyFee(uint256 grossNativeIn) external pure returns (uint256) {
        return _tradingFee(grossNativeIn);
    }

    /// @notice Net native currency received for selling `tokensIn`, after the 1% trading fee.
    function quoteSell(uint256 tokensIn) public view returns (uint256 nativeOut) {
        uint256 grossNativeOut = _quoteSellGross(tokensIn);
        if (grossNativeOut == 0) return 0;
        uint256 fee = _tradingFee(grossNativeOut);
        nativeOut = grossNativeOut - fee;
    }

    /// @notice Fee charged on the gross curve output of selling `tokensIn`.
    function quoteSellFee(uint256 tokensIn) external view returns (uint256) {
        return _tradingFee(_quoteSellGross(tokensIn));
    }

    /// @notice Minimum funding that both reaches the target and seeds a usable pool.
    function minimumCurveFunding() public view returns (uint256) {
        uint256 tokensSoldAtTarget = Math.mulDiv(
            graduationTarget,
            initialVirtualTokenReserve,
            initialVirtualEthReserve + graduationTarget
        );
        uint256 minimumPoolTokens = (POOL_MINIMUM_LIQUIDITY_SQUARED / graduationTarget) + 1;
        return tokensSoldAtTarget + minimumPoolTokens;
    }

    function remainingNativeToGraduate() external view returns (uint256) {
        if (graduated) return 0;
        return graduationTarget - realNativeReserve;
    }

    function nativeReserve() external view returns (uint256) {
        return realNativeReserve;
    }

    function actualNativeBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function tokensAvailable() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function graduationProgressBps() external view returns (uint256) {
        if (graduated) return BPS;
        if (realNativeReserve >= graduationTarget) return BPS;
        return Math.mulDiv(realNativeReserve, BPS, graduationTarget);
    }

    /// @dev Fee liability is excluded from graduation liquidity: the pool is
    ///      seeded from `realNativeReserve` only, so accrued treasury/creator
    ///      fee balances remain outside pool liquidity and stay withdrawable
    ///      after graduation.
    function _graduate() internal {
        uint256 tokenLiquidity = token.balanceOf(address(this));
        uint256 nativeLiquidity = realNativeReserve;
        if (tokenLiquidity == 0 || nativeLiquidity == 0) revert InvalidConfiguration();

        graduated = true;
        realNativeReserve = 0;

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

    /// @dev 1% trading fee, rounded up so a nonzero trade can never dodge the
    ///      fee to zero through integer rounding.
    function _tradingFee(uint256 amount) internal pure returns (uint256) {
        if (amount == 0) return 0;
        return Math.mulDiv(amount, TRADING_FEE_BPS, BPS, Math.Rounding.Ceil);
    }

    /// @dev Splits `feeAmount` 60/40 between treasury and creator with a
    ///      carried remainder, so repeated tiny-trade rounding cannot
    ///      permanently skew the aggregate split and every fee wei is
    ///      accounted for on one side or the other.
    function _accrueFee(uint256 feeAmount)
        private
        returns (uint256 treasuryShare, uint256 creatorShare)
    {
        uint256 scaledTreasury = feeAmount * PROTOCOL_FEE_SHARE_BPS + treasuryShareRemainder;
        treasuryShare = scaledTreasury / BPS;
        treasuryShareRemainder = scaledTreasury % BPS;
        creatorShare = feeAmount - treasuryShare;

        treasuryFeeBalance += treasuryShare;
        creatorFeeBalance += creatorShare;
    }

    function _quoteSellGross(uint256 tokensIn) private view returns (uint256 nativeOut) {
        if (tokensIn == 0) return 0;
        nativeOut = Math.mulDiv(tokensIn, virtualEthReserve, virtualTokenReserve + tokensIn);
    }

    function _safeTransferNative(address to, uint256 amount) internal {
        (bool sent,) = payable(to).call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
    }

    receive() external payable {
        revert DirectPaymentNotAccepted();
    }
}

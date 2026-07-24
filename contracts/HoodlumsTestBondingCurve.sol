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
///      Every buy and sell pays a fixed 1% trading fee, split 60% to the protocol
///      treasury and 40% to the token creator. Fees are never pushed to either
///      recipient: they only accrue to a claimable balance, withdrawn by the
///      recipient itself via `withdrawFees()`. This keeps a reverting or
///      gas-griefing recipient from ever blocking a buy, a sell, graduation, or
///      the other recipient's withdrawal. Fee balances are tracked separately
///      from `realNativeReserve` and are never counted as curve or pool
///      liquidity, so they remain withdrawable before and after graduation.
contract HoodlumsTestBondingCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant POOL_MINIMUM_LIQUIDITY_SQUARED = 1_002_001;
    address public constant LP_LOCK_ADDRESS = address(1);

    /// @dev Total trading fee charged on every buy and sell, in basis points of BPS.
    uint256 public constant TRADING_FEE_BPS = 100;
    /// @dev Share of every trading fee paid to `treasury`, in basis points of BPS.
    uint256 public constant PROTOCOL_FEE_SHARE_BPS = 6_000;
    /// @dev Share of every trading fee paid to `creator`, in basis points of BPS.
    uint256 public constant CREATOR_FEE_SHARE_BPS = 4_000;

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

    /// @notice Native currency owed to the treasury, claimable via `withdrawFees()`.
    uint256 public treasuryFeeBalance;
    /// @notice Native currency owed to the creator, claimable via `withdrawFees()`.
    uint256 public creatorFeeBalance;
    /// @notice Lifetime total of all trading fees ever accrued (treasury + creator).
    uint256 public totalFeesAccrued;
    /// @notice Lifetime total of all trading fees ever withdrawn (treasury + creator).
    uint256 public totalFeesWithdrawn;
    /// @notice Fractional treasury-share remainder (out of BPS) carried between
    ///         fee splits so integer rounding on tiny fees cannot permanently
    ///         skew the long-run allocation away from 60/40.
    uint256 public treasuryShareCarry;

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
    error NoFeesToWithdraw();
    error NotFeeRecipient();

    event CurveFunded(address indexed creator, uint256 tokenAmount);
    event TokensPurchased(
        address indexed buyer,
        uint256 grossNativeIn,
        uint256 netNativeIn,
        uint256 tokensOut,
        uint256 feeCharged,
        uint256 virtualTokenReserve,
        uint256 virtualEthReserve
    );
    event TokensSold(
        address indexed seller,
        uint256 tokensIn,
        uint256 grossNativeOut,
        uint256 netNativeOut,
        uint256 feeCharged,
        uint256 virtualTokenReserve,
        uint256 virtualEthReserve
    );
    event CurveGraduated(
        address indexed pool,
        uint256 tokenLiquidity,
        uint256 nativeLiquidity,
        uint256 lpLocked
    );
    event FeeAccrued(address indexed recipient, uint256 amount);
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
    /// @dev `msg.value` is the gross input. A 1% fee is deducted first; only the
    ///      post-fee amount is quoted against the curve and counted toward
    ///      `realNativeReserve` / graduation. The fee accrues to claimable
    ///      balances and is never pushed to the treasury or creator here.
    function buy(uint256 minTokensOut, uint256 deadline)
        external
        payable
        nonReentrant
        tradingOpen
        beforeDeadline(deadline)
        returns (uint256 tokensOut)
    {
        if (msg.value == 0) revert ZeroInput();

        uint256 fee = _tradingFee(msg.value);
        uint256 netIn = msg.value - fee;

        uint256 remainingToGraduate = graduationTarget - realNativeReserve;
        if (netIn > remainingToGraduate) {
            revert BuyExceedsGraduationTarget(remainingToGraduate, netIn);
        }

        tokensOut = _quoteBuyNet(netIn);
        if (tokensOut == 0 || tokensOut < minTokensOut) revert SlippageExceeded();
        if (tokensOut > token.balanceOf(address(this))) revert InsufficientCurveTokens();

        virtualEthReserve += netIn;
        virtualTokenReserve -= tokensOut;
        realNativeReserve += netIn;
        _accrueFee(fee);

        token.safeTransfer(msg.sender, tokensOut);

        emit TokensPurchased(
            msg.sender,
            msg.value,
            netIn,
            tokensOut,
            fee,
            virtualTokenReserve,
            virtualEthReserve
        );

        if (realNativeReserve == graduationTarget) {
            _graduate();
        }
    }

    /// @notice Sell curve tokens back for native testnet currency.
    /// @dev The gross native output is computed from the curve first. A 1% fee
    ///      is deducted from that gross amount before paying the seller. Both
    ///      virtual and real reserves are reduced by the gross curve output, so
    ///      the fee never distorts curve pricing; it only accrues to claimable
    ///      balances.
    function sell(uint256 tokensIn, uint256 minNativeOut, uint256 deadline)
        external
        nonReentrant
        tradingOpen
        beforeDeadline(deadline)
        returns (uint256 nativeOut)
    {
        if (tokensIn == 0) revert ZeroInput();

        uint256 grossNativeOut = _quoteSellGross(tokensIn);
        if (grossNativeOut == 0) revert SlippageExceeded();
        if (grossNativeOut > realNativeReserve) revert InsufficientNativeReserve();

        uint256 fee = _tradingFee(grossNativeOut);
        nativeOut = grossNativeOut - fee;
        if (nativeOut == 0 || nativeOut < minNativeOut) revert SlippageExceeded();

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), tokensIn);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != tokensIn) revert UnsupportedTokenTransfer();

        virtualTokenReserve += tokensIn;
        virtualEthReserve -= grossNativeOut;
        realNativeReserve -= grossNativeOut;
        _accrueFee(fee);

        _safeTransferNative(msg.sender, nativeOut);

        emit TokensSold(
            msg.sender,
            tokensIn,
            grossNativeOut,
            nativeOut,
            fee,
            virtualTokenReserve,
            virtualEthReserve
        );
    }

    /// @notice Permissionless fallback graduation once the target is met.
    function graduate() external nonReentrant tradingOpen {
        if (realNativeReserve < graduationTarget) revert GraduationTargetNotReached();
        _graduate();
    }

    /// @notice Withdraw the caller's claimable trading fees.
    /// @dev Pull payment: only the treasury or the creator can call this, and
    ///      each can only withdraw its own balance. Checks-effects-interactions
    ///      and `nonReentrant` ensure a reverting or malicious recipient cannot
    ///      block their own future withdrawals or the other recipient's.
    function withdrawFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender == treasury) {
            amount = treasuryFeeBalance;
            if (amount == 0) revert NoFeesToWithdraw();
            treasuryFeeBalance = 0;
            totalFeesWithdrawn += amount;
            emit FeeWithdrawn(msg.sender, amount);
            _safeTransferNative(msg.sender, amount);
        } else if (msg.sender == creator) {
            amount = creatorFeeBalance;
            if (amount == 0) revert NoFeesToWithdraw();
            creatorFeeBalance = 0;
            totalFeesWithdrawn += amount;
            emit FeeWithdrawn(msg.sender, amount);
            _safeTransferNative(msg.sender, amount);
        } else {
            revert NotFeeRecipient();
        }
    }

    /// @notice Net tokens a buyer receives for a given gross native input, after fees.
    function quoteBuy(uint256 grossNativeIn) public view returns (uint256 tokensOut) {
        if (grossNativeIn == 0) return 0;
        uint256 fee = _tradingFee(grossNativeIn);
        tokensOut = _quoteBuyNet(grossNativeIn - fee);
    }

    /// @notice Net native currency a seller receives for a given token input, after fees.
    function quoteSell(uint256 tokensIn) public view returns (uint256 nativeOut) {
        uint256 grossNativeOut = _quoteSellGross(tokensIn);
        if (grossNativeOut == 0) return 0;
        uint256 fee = _tradingFee(grossNativeOut);
        nativeOut = grossNativeOut - fee;
    }

    /// @notice Trading fee that would be charged on a gross buy input.
    function quoteBuyFee(uint256 grossNativeIn) external pure returns (uint256) {
        return _tradingFee(grossNativeIn);
    }

    /// @notice Trading fee that would be charged on a sell's gross native output.
    function quoteSellFee(uint256 tokensIn) external view returns (uint256) {
        return _tradingFee(_quoteSellGross(tokensIn));
    }

    /// @notice Claimable fee balance for the treasury or the creator, zero for any other address.
    function claimableFees(address recipient) external view returns (uint256) {
        if (recipient == treasury) return treasuryFeeBalance;
        if (recipient == creator) return creatorFeeBalance;
        return 0;
    }

    /// @notice Total accrued fee liability currently outstanding across both recipients.
    function totalClaimableFees() external view returns (uint256) {
        return treasuryFeeBalance + creatorFeeBalance;
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

    /// @dev Seeds the pool using only `realNativeReserve`, which already excludes
    ///      every accrued fee. Fee balances stay in this contract's native
    ///      balance and remain withdrawable via `withdrawFees()` after graduation.
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

    /// @dev Splits an already-charged fee 60/40 between treasury and creator and
    ///      accrues both shares to claimable balances. Every wei of every fee is
    ///      assigned to one side or the other (no untracked remainder): the
    ///      treasury's fractional entitlement (`fee * 6000 / BPS`) is computed
    ///      with a carried-forward remainder from prior splits, so a fee too
    ///      small to award the treasury a whole wei on its own still counts
    ///      toward the treasury once the carry accumulates past a full BPS unit.
    ///      This keeps the long-run aggregate split converging on exactly 60/40
    ///      instead of always rounding tiny fees toward the creator.
    function _accrueFee(uint256 fee) internal {
        if (fee == 0) return;

        uint256 scaledTreasuryShare = fee * PROTOCOL_FEE_SHARE_BPS + treasuryShareCarry;
        uint256 treasuryShare = scaledTreasuryShare / BPS;
        treasuryShareCarry = scaledTreasuryShare % BPS;
        uint256 creatorShare = fee - treasuryShare;

        treasuryFeeBalance += treasuryShare;
        creatorFeeBalance += creatorShare;
        totalFeesAccrued += fee;

        emit FeeAccrued(treasury, treasuryShare);
        emit FeeAccrued(creator, creatorShare);
    }

    /// @dev Rounds the fee up so any nonzero amount is charged a strictly
    ///      positive fee (or the trade is rejected because the fee consumes the
    ///      full amount), preventing tiny trades from evading the 1% fee via
    ///      integer truncation.
    function _tradingFee(uint256 amount) internal pure returns (uint256) {
        if (amount == 0) return 0;
        return Math.mulDiv(amount, TRADING_FEE_BPS, BPS, Math.Rounding.Ceil);
    }

    function _quoteBuyNet(uint256 netNativeIn) internal view returns (uint256 tokensOut) {
        if (netNativeIn == 0) return 0;
        tokensOut = Math.mulDiv(
            netNativeIn,
            virtualTokenReserve,
            virtualEthReserve + netNativeIn
        );
    }

    function _quoteSellGross(uint256 tokensIn) internal view returns (uint256 nativeOutGross) {
        if (tokensIn == 0) return 0;
        nativeOutGross = Math.mulDiv(
            tokensIn,
            virtualEthReserve,
            virtualTokenReserve + tokensIn
        );
    }

    function _safeTransferNative(address to, uint256 amount) internal {
        (bool sent,) = payable(to).call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
    }

    receive() external payable {
        revert DirectPaymentNotAccepted();
    }
}

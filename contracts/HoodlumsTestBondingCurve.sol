// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {
    IWETH9,
    IUniswapV3Factory,
    IUniswapV3Pool,
    INonfungiblePositionManager
} from "./UniswapV3Interfaces.sol";

/// @dev Trimmed view of the ERC20Burnable surface needed to burn graduation
///      dust. Every token this curve is deployed for is required to be
///      ERC20Burnable (see `_graduate`'s leftover sweep).
interface IERC20Burnable {
    function burn(uint256 value) external;
}

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
///      Graduation first charges a fixed 5% graduation fee on the post-trading-
///      fee native reserve, credited 100% to the treasury's claimable balance
///      (never the creator's, never pushed), then seeds a full-range Uniswap V3
///      position with the remaining 95% (wrapping it into WETH first) and
///      permanently locks the resulting
///      LP NFT at `LP_LOCK_ADDRESS`, so nobody — including the creator or
///      this contract's owner — can ever withdraw graduated liquidity.
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
    /// @dev One-off fee charged on the native reserve at graduation, in basis
    ///      points of BPS (5%), credited entirely to `treasury`'s claimable
    ///      balance. Only the remaining 95% seeds the locked pool. Rounded
    ///      down, so rounding always favours pool liquidity, never the fee.
    uint256 public constant GRADUATION_FEE_BPS = 500;

    /// @dev Uniswap V3's 1% fee tier, matching what Pons uses for graduated pools.
    uint24 public constant UNISWAP_FEE_TIER = 10_000;
    /// @dev Uniswap V3's global tick bounds; the graduation position spans the
    ///      widest range each usable to this fee tier's tick spacing, so it
    ///      behaves like a constant-product V2 pool across any price.
    int24 public constant MIN_TICK = -887272;
    int24 public constant MAX_TICK = 887272;

    /// @dev Minimum share of each side's desired amount the graduation mint
    ///      must actually consume, in basis points of BPS (99%). Uniswap V3
    ///      pool creation/initialization is permissionless, so an attacker
    ///      could pre-create and pre-initialize the token/WETH pool at an
    ///      extreme price before the curve graduates. Without a floor, the
    ///      mint would silently deposit the whole graduation liquidity at
    ///      that attacker-chosen price. These floors make Uniswap's own
    ///      position manager revert the mint instead.
    uint256 public constant GRADUATION_MIN_DEPOSIT_BPS = 9_900;
    /// @dev Maximum allowed deviation of an already-initialized pool's
    ///      `sqrtPriceX96` from the curve's own desired ratio, in basis
    ///      points of BPS applied to the sqrt value (see `_getOrCreateInitializedPool`).
    uint256 public constant POOL_SQRT_PRICE_TOLERANCE_BPS = 50;

    IERC20 public immutable token;
    address public immutable creator;
    address public immutable treasury;
    uint256 public immutable initialVirtualTokenReserve;
    uint256 public immutable initialVirtualEthReserve;
    uint256 public immutable graduationTarget;
    IUniswapV3Factory public immutable uniswapV3Factory;
    INonfungiblePositionManager public immutable positionManager;
    IWETH9 public immutable weth9;

    uint256 public virtualTokenReserve;
    uint256 public virtualEthReserve;
    uint256 public curveTokenSupply;
    uint256 public realNativeReserve;

    /// @notice Native currency owed to the treasury, claimable via `withdrawFees()`.
    uint256 public treasuryFeeBalance;
    /// @notice Native currency owed to the creator, claimable via `withdrawFees()`.
    uint256 public creatorFeeBalance;
    /// @notice Lifetime total of all fees ever accrued (treasury + creator):
    ///         every trading fee, the graduation fee, and any swept graduation dust.
    uint256 public totalFeesAccrued;
    /// @notice Lifetime total of all fees ever withdrawn (treasury + creator).
    uint256 public totalFeesWithdrawn;
    /// @notice Fractional treasury-share remainder (out of BPS) carried between
    ///         fee splits so integer rounding on tiny fees cannot permanently
    ///         skew the long-run allocation away from 60/40.
    uint256 public treasuryShareCarry;

    bool public funded;
    bool public graduated;
    /// @notice The Uniswap V3 pool address for this token/WETH pair once graduated.
    address public liquidityPool;
    /// @notice The `positionManager` LP NFT token ID locked at `LP_LOCK_ADDRESS` once graduated.
    uint256 public lpTokenId;

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
    error PoolPriceOutOfTolerance(uint160 existingSqrtPriceX96, uint160 desiredSqrtPriceX96);

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
    /// @notice `nativeLiquidity` is the post-graduation-fee amount actually
    ///         deposited into the pool — the reserve minus `GraduationFeeCharged.amount`.
    event Graduated(
        address indexed pool,
        uint256 indexed tokenId,
        uint256 tokenLiquidity,
        uint256 nativeLiquidity
    );
    /// @notice The one-off GRADUATION_FEE_BPS fee taken from the native reserve
    ///         at graduation and credited to `treasuryFeeBalance`.
    event GraduationFeeCharged(uint256 amount);
    event FeeAccrued(address indexed recipient, uint256 amount);
    event FeeWithdrawn(address indexed recipient, uint256 amount);
    /// @notice Dust left over after the graduation mint, swept instead of
    ///         stranded: `tokenBurned` is destroyed, `nativeAccrued` is added
    ///         to the existing 60/40 treasury/creator claimable fee balances.
    event GraduationDustSwept(uint256 tokenBurned, uint256 nativeAccrued);

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
        uint256 graduationTarget_,
        address positionManager_,
        address uniswapV3Factory_,
        address weth9_
    ) {
        if (
            token_ == address(0) ||
            creator_ == address(0) ||
            treasury_ == address(0) ||
            positionManager_ == address(0) ||
            uniswapV3Factory_ == address(0) ||
            weth9_ == address(0)
        ) {
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
        positionManager = INonfungiblePositionManager(positionManager_);
        uniswapV3Factory = IUniswapV3Factory(uniswapV3Factory_);
        weth9 = IWETH9(weth9_);
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
    /// @dev Pull payment: only the treasury or the creator can call this. If
    ///      `treasury == creator`, the shared address withdraws both balances
    ///      in one call so neither share is ever stranded. Checks-effects-
    ///      interactions and `nonReentrant` ensure a reverting or malicious
    ///      recipient cannot block their own future withdrawals or the other
    ///      recipient's.
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

        totalFeesWithdrawn += amount;
        emit FeeWithdrawn(msg.sender, amount);
        _safeTransferNative(msg.sender, amount);
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

    /// @notice Claimable fee balance for `recipient`. If `recipient` is both the
    ///         treasury and the creator, returns the sum of both balances; zero
    ///         for any address that is neither.
    function claimableFees(address recipient) external view returns (uint256 amount) {
        if (recipient == treasury) amount += treasuryFeeBalance;
        if (recipient == creator) amount += creatorFeeBalance;
    }

    /// @notice Total accrued fee liability currently outstanding across both recipients.
    function totalClaimableFees() external view returns (uint256) {
        return treasuryFeeBalance + creatorFeeBalance;
    }

    /// @notice The graduation fee that will be charged when the curve graduates,
    ///         i.e. GRADUATION_FEE_BPS of `graduationTarget` (the reserve always
    ///         equals the target exactly at the moment of graduation).
    function graduationFeeAtTarget() external view returns (uint256) {
        return _graduationFee(graduationTarget);
    }

    /// @notice Minimum funding that both reaches the target and seeds a usable pool.
    /// @dev The pool-liquidity floor is measured against the native amount that
    ///      actually reaches the pool — the target minus the graduation fee.
    function minimumCurveFunding() public view returns (uint256) {
        uint256 tokensSoldAtTarget = Math.mulDiv(
            graduationTarget,
            initialVirtualTokenReserve,
            initialVirtualEthReserve + graduationTarget
        );
        uint256 nativeIntoPool = graduationTarget - _graduationFee(graduationTarget);
        uint256 minimumPoolTokens = (POOL_MINIMUM_LIQUIDITY_SQUARED / nativeIntoPool) + 1;
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

    /// @dev Charges the one-off GRADUATION_FEE_BPS fee on `realNativeReserve`
    ///      (which already excludes every accrued trading fee), crediting it
    ///      100% to `treasuryFeeBalance` — a pull-payment balance like every
    ///      trading fee, never pushed — then seeds a full-range Uniswap V3
    ///      position with the remainder. Fee balances stay in this contract's
    ///      native balance and remain withdrawable via `withdrawFees()` after
    ///      graduation. Every step below is a plain
    ///      external call with no try/catch, so a failure anywhere — wrapping,
    ///      pool creation/initialization, or the liquidity mint itself —
    ///      reverts the entire transaction and undoes `graduated = true` and
    ///      `realNativeReserve = 0` along with it; graduation cannot partially
    ///      complete. Reentrancy is guarded by `nonReentrant` on the external
    ///      `buy()`/`sell()`/`graduate()` entry points that call this.
    function _graduate() internal {
        uint256 tokenLiquidity = token.balanceOf(address(this));
        uint256 reserve = realNativeReserve;
        uint256 graduationFee = _graduationFee(reserve);
        uint256 nativeLiquidity = reserve - graduationFee;
        if (tokenLiquidity == 0 || nativeLiquidity == 0) revert InvalidConfiguration();

        graduated = true;
        realNativeReserve = 0;

        if (graduationFee > 0) {
            treasuryFeeBalance += graduationFee;
            totalFeesAccrued += graduationFee;
            emit FeeAccrued(treasury, graduationFee);
            emit GraduationFeeCharged(graduationFee);
        }

        weth9.deposit{value: nativeLiquidity}();

        (address token0, address token1, uint256 amount0Desired, uint256 amount1Desired) =
            _orderGraduationTokens(tokenLiquidity, nativeLiquidity);

        address pool = _getOrCreateInitializedPool(token0, token1, amount0Desired, amount1Desired);
        (int24 tickLower, int24 tickUpper) = _fullRangeTicks();

        token.forceApprove(address(positionManager), tokenLiquidity);
        if (!weth9.approve(address(positionManager), nativeLiquidity)) revert LiquidityLockFailed();

        (uint256 tokenId,, uint256 amount0, uint256 amount1) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: UNISWAP_FEE_TIER,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                // At least GRADUATION_MIN_DEPOSIT_BPS of each side must be
                // consumed, or the position manager reverts the mint. See
                // GRADUATION_MIN_DEPOSIT_BPS for why this floor exists.
                amount0Min: Math.mulDiv(amount0Desired, GRADUATION_MIN_DEPOSIT_BPS, BPS),
                amount1Min: Math.mulDiv(amount1Desired, GRADUATION_MIN_DEPOSIT_BPS, BPS),
                recipient: LP_LOCK_ADDRESS,
                deadline: block.timestamp
            })
        );

        token.forceApprove(address(positionManager), 0);
        if (!weth9.approve(address(positionManager), 0)) revert LiquidityLockFailed();

        liquidityPool = pool;
        lpTokenId = tokenId;

        emit Graduated(pool, tokenId, tokenLiquidity, nativeLiquidity);

        _sweepGraduationLeftover(token0, amount0Desired, amount1Desired, amount0, amount1);
    }

    /// @dev Orders the token/WETH pair the way Uniswap V3 requires (token0 <
    ///      token1 by address) and maps the graduation amounts onto that order.
    function _orderGraduationTokens(uint256 tokenLiquidity, uint256 nativeLiquidity)
        internal
        view
        returns (address token0, address token1, uint256 amount0Desired, uint256 amount1Desired)
    {
        address tokenAddress = address(token);
        address wethAddress = address(weth9);
        bool tokenIsToken0 = tokenAddress < wethAddress;
        token0 = tokenIsToken0 ? tokenAddress : wethAddress;
        token1 = tokenIsToken0 ? wethAddress : tokenAddress;
        amount0Desired = tokenIsToken0 ? tokenLiquidity : nativeLiquidity;
        amount1Desired = tokenIsToken0 ? nativeLiquidity : tokenLiquidity;
    }

    /// @dev Looks up this token/WETH pool from the factory, creating it if
    ///      necessary. A brand-new pool is initialized at the curve's exact
    ///      desired ratio. Uniswap V3 pool creation/initialization is
    ///      permissionless, so an already-existing, already-initialized pool
    ///      may have been pre-rigged by an attacker who saw the curve nearing
    ///      its graduation target; such a pool is only accepted if its price
    ///      is within POOL_SQRT_PRICE_TOLERANCE_BPS of the curve's desired
    ///      ratio, otherwise this reverts PoolPriceOutOfTolerance rather than
    ///      depositing the whole graduation liquidity at an attacker-chosen
    ///      price. This is temporary protection, not a bricked state: a
    ///      rigged pool self-corrects via arbitrage (its price converges back
    ///      toward the market price), after which the next qualifying buy —
    ///      or a direct `graduate()` call, both of which retry `_graduate()`
    ///      — succeeds normally.
    function _getOrCreateInitializedPool(
        address token0,
        address token1,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) internal returns (address pool) {
        pool = uniswapV3Factory.getPool(token0, token1, UNISWAP_FEE_TIER);
        if (pool == address(0)) {
            pool = uniswapV3Factory.createPool(token0, token1, UNISWAP_FEE_TIER);
        }

        uint160 desiredSqrtPriceX96 = _initialSqrtPriceX96(amount0Desired, amount1Desired);
        (uint160 existingSqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (existingSqrtPriceX96 == 0) {
            IUniswapV3Pool(pool).initialize(desiredSqrtPriceX96);
        } else if (!_withinSqrtPriceTolerance(existingSqrtPriceX96, desiredSqrtPriceX96)) {
            revert PoolPriceOutOfTolerance(existingSqrtPriceX96, desiredSqrtPriceX96);
        }
    }

    /// @dev price = (sqrtPriceX96 / 2^96)^2, so a fractional tolerance `t` on
    ///      sqrtPriceX96 is approximately a fractional tolerance `2t` on price
    ///      itself (since (1±t)^2 ≈ 1±2t for small t). POOL_SQRT_PRICE_TOLERANCE_BPS
    ///      = 50 bps (0.5%) on the sqrt value is therefore roughly a ±1% price
    ///      tolerance, matching the ~1% price tolerance this check is meant to
    ///      enforce.
    function _withinSqrtPriceTolerance(uint160 existingSqrtPriceX96, uint160 desiredSqrtPriceX96)
        internal
        pure
        returns (bool)
    {
        uint256 lowerBound =
            Math.mulDiv(uint256(desiredSqrtPriceX96), BPS - POOL_SQRT_PRICE_TOLERANCE_BPS, BPS);
        uint256 upperBound =
            Math.mulDiv(uint256(desiredSqrtPriceX96), BPS + POOL_SQRT_PRICE_TOLERANCE_BPS, BPS);
        return uint256(existingSqrtPriceX96) >= lowerBound && uint256(existingSqrtPriceX96) <= upperBound;
    }

    /// @dev Burns any token the mint didn't consume and unwraps+accrues any
    ///      WETH it didn't consume via the existing 60/40 treasury/creator
    ///      fee split, so nothing from the graduation deposit is ever left
    ///      stranded in this contract and no new payment route is invented.
    ///      With GRADUATION_MIN_DEPOSIT_BPS floors on the mint, both leftovers
    ///      are bounded to at most 1% of their respective desired amounts.
    function _sweepGraduationLeftover(
        address token0,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0,
        uint256 amount1
    ) internal {
        bool tokenIsToken0 = token0 == address(token);
        uint256 leftoverToken = tokenIsToken0 ? amount0Desired - amount0 : amount1Desired - amount1;
        uint256 leftoverWeth = tokenIsToken0 ? amount1Desired - amount1 : amount0Desired - amount0;
        if (leftoverToken == 0 && leftoverWeth == 0) return;

        if (leftoverToken > 0) {
            IERC20Burnable(address(token)).burn(leftoverToken);
        }
        if (leftoverWeth > 0) {
            weth9.withdraw(leftoverWeth);
            _accrueFee(leftoverWeth);
        }

        emit GraduationDustSwept(leftoverToken, leftoverWeth);
    }

    /// @dev The widest tick range this fee tier's spacing allows, so the
    ///      position behaves like a constant-product V2 pool across any price.
    function _fullRangeTicks() internal view returns (int24 tickLower, int24 tickUpper) {
        int24 tickSpacing = uniswapV3Factory.feeAmountTickSpacing(UNISWAP_FEE_TIER);
        if (tickSpacing == 0) revert InvalidConfiguration();
        tickLower = (MIN_TICK / tickSpacing) * tickSpacing;
        tickUpper = (MAX_TICK / tickSpacing) * tickSpacing;
    }

    /// @dev sqrtPriceX96 = sqrt(amount1 / amount0) * 2^96, the standard Uniswap
    ///      V3 initial-price encoding. Used only to seed a fresh pool's price
    ///      to match the exact ratio being deposited, so the full-range mint
    ///      below consumes the whole of both `amount0Desired`/`amount1Desired`
    ///      rather than being constrained by a mismatched existing price.
    function _initialSqrtPriceX96(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        uint256 ratioX192 = Math.mulDiv(amount1, uint256(1) << 192, amount0);
        return SafeCast.toUint160(Math.sqrt(ratioX192));
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

    /// @dev The one-off graduation fee on a native reserve, rounded DOWN (unlike
    ///      `_tradingFee`): the fee cannot be evaded by trade sizing because the
    ///      reserve equals the immutable target at graduation, so rounding here
    ///      only ever favours the pool's liquidity over the treasury's take.
    function _graduationFee(uint256 reserve) internal pure returns (uint256) {
        return Math.mulDiv(reserve, GRADUATION_FEE_BPS, BPS);
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

    /// @dev Direct payments are rejected so only recorded buys count toward
    ///      graduation (see `testOnlyRecordedBuysCountTowardGraduation`).
    ///      The sole exception is `weth9` itself paying back a `withdraw()`
    ///      call from `_sweepGraduationLeftover` — `weth9` is immutable, set
    ///      once at construction, so this cannot be spoofed by anyone else.
    receive() external payable {
        if (msg.sender != address(weth9)) revert DirectPaymentNotAccepted();
    }
}

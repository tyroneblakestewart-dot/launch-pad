// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @dev Wrapped native currency: only `deposit()` beyond plain ERC-20 is needed here.
interface IWETH9 is IERC20 {
    function deposit() external payable;
}

/// @dev Minimal slice of Uniswap V3's `IUniswapV3Factory` needed to create or
///      locate the canonical token/WETH pool for the configured fee tier.
interface IUniswapV3FactoryMinimal {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
}

/// @dev Minimal slice of Uniswap V3's `IUniswapV3Pool` needed to read/set the
///      pool's initial price exactly once.
interface IUniswapV3PoolMinimal {
    function initialize(uint160 sqrtPriceX96) external;
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

/// @dev Minimal slice of Uniswap V3's `INonfungiblePositionManager` needed to
///      mint a full-range concentrated liquidity position and move the
///      resulting LP NFT. Matches the real contract's ABI exactly so a live
///      deployment can be wired in via constructor address.
interface INonfungiblePositionManagerMinimal {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function safeTransferFrom(address from, address to, uint256 tokenId) external;
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
contract HoodlumsTestBondingCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant POOL_MINIMUM_LIQUIDITY_SQUARED = 1_002_001;
    address public constant LP_LOCK_ADDRESS = address(1);

    /// @dev Uniswap V3's 1% fee tier, matching what Pons uses for graduation pools.
    uint24 public constant POOL_FEE_TIER = 10_000;
    /// @dev Tick spacing Uniswap V3 fixes for the 1% fee tier.
    int24 public constant POOL_TICK_SPACING = 200;
    /// @dev Widest usable ticks for `POOL_TICK_SPACING` (nearest multiples of
    ///      200 inside TickMath's [MIN_TICK, MAX_TICK]), so the minted
    ///      position spans the full price range like a V2 pool.
    int24 public constant MIN_TICK = -887200;
    int24 public constant MAX_TICK = 887200;

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

    /// @dev Uniswap V3 `NonfungiblePositionManager` used to mint the
    ///      graduation liquidity position. Never hardcoded: passed in at
    ///      deploy time so the same contract works against testnet or
    ///      mainnet Uniswap deployments.
    address public immutable positionManager;
    /// @dev Uniswap V3 `UniswapV3Factory` used to create or locate the
    ///      token/WETH pool for `POOL_FEE_TIER`.
    address public immutable uniswapV3Factory;
    /// @dev Wrapped native currency Uniswap V3 pairs the token against.
    address public immutable weth9;

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
    /// @notice Emitted once graduation seeds the Uniswap V3 position and
    ///         permanently locks the resulting LP NFT.
    event Graduated(address indexed pool, uint256 indexed tokenId);
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
        if (token_ == weth9_) revert InvalidConfiguration();
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
        positionManager = positionManager_;
        uniswapV3Factory = uniswapV3Factory_;
        weth9 = weth9_;
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

    /// @dev Seeds a full-range Uniswap V3 position using only
    ///      `realNativeReserve`, which already excludes every accrued fee. Fee
    ///      balances stay in this contract's native balance and remain
    ///      withdrawable via `withdrawFees()` after graduation. Called only
    ///      from `buy()` and `graduate()`, both `nonReentrant`, so every
    ///      external call below (WETH, factory, pool, position manager) runs
    ///      under that same reentrancy lock. Every step is a normal
    ///      (non-low-level) external call or a checked transfer, so a failure
    ///      anywhere — pool creation, initialization, or `mint()` — reverts
    ///      the entire transaction and undoes every state change made here
    ///      and in the caller; graduation cannot partially complete.
    function _graduate() internal {
        uint256 tokenLiquidity = token.balanceOf(address(this));
        uint256 nativeLiquidity = realNativeReserve;
        if (tokenLiquidity == 0 || nativeLiquidity == 0) revert InvalidConfiguration();

        graduated = true;
        realNativeReserve = 0;

        IWETH9(weth9).deposit{value: nativeLiquidity}();

        bool tokenIsToken0 = address(token) < weth9;
        address token0 = tokenIsToken0 ? address(token) : weth9;
        address token1 = tokenIsToken0 ? weth9 : address(token);
        uint256 amount0 = tokenIsToken0 ? tokenLiquidity : nativeLiquidity;
        uint256 amount1 = tokenIsToken0 ? nativeLiquidity : tokenLiquidity;

        address pool = IUniswapV3FactoryMinimal(uniswapV3Factory).getPool(token0, token1, POOL_FEE_TIER);
        if (pool == address(0)) {
            pool = IUniswapV3FactoryMinimal(uniswapV3Factory).createPool(token0, token1, POOL_FEE_TIER);
        }

        (uint160 existingSqrtPriceX96,,,,,,) = IUniswapV3PoolMinimal(pool).slot0();
        if (existingSqrtPriceX96 == 0) {
            IUniswapV3PoolMinimal(pool).initialize(_sqrtPriceX96(amount1, amount0));
        }

        token.forceApprove(positionManager, tokenLiquidity);
        IWETH9(weth9).approve(positionManager, nativeLiquidity);

        (uint256 tokenId,,,) = INonfungiblePositionManagerMinimal(positionManager).mint(
            INonfungiblePositionManagerMinimal.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE_TIER,
                tickLower: MIN_TICK,
                tickUpper: MAX_TICK,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );

        token.forceApprove(positionManager, 0);
        IWETH9(weth9).approve(positionManager, 0);

        liquidityPool = pool;
        INonfungiblePositionManagerMinimal(positionManager).safeTransferFrom(address(this), LP_LOCK_ADDRESS, tokenId);

        emit Graduated(pool, tokenId);
    }

    /// @dev Uniswap V3's initial price for a fresh pool, expressed as
    ///      `sqrt(reserve1 / reserve0) * 2^96`. For a full-range position this
    ///      is also the exact token ratio `mint()` will consume, so graduation
    ///      uses (up to rounding) the complete token and native liquidity, the
    ///      same guarantee the previous constant-product pool gave.
    function _sqrtPriceX96(uint256 reserve1, uint256 reserve0) internal pure returns (uint160) {
        uint256 ratioX192 = Math.mulDiv(reserve1, 1 << 192, reserve0);
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

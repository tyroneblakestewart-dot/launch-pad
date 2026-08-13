// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IWETH9,
    IUniswapV3Factory,
    IUniswapV3Pool,
    INonfungiblePositionManager
} from "../UniswapV3Interfaces.sol";

/// @dev Test-only stand-ins for the real Uniswap V3 deployment, used because
///      no genuine Uniswap V3 contracts are deployed on the Hardhat test
///      network. Not audited, not gas-optimised, and not for any other use.

contract MockWETH9 is IWETH9 {
    string public constant name = "Wrapped Ether";
    string public constant symbol = "WETH";
    uint8 public constant decimals = 18;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) public allowance;

    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);

    function deposit() external payable override {
        _balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) external override {
        require(_balances[msg.sender] >= wad, "WETH_BALANCE");
        _balances[msg.sender] -= wad;
        (bool sent,) = msg.sender.call{value: wad}("");
        require(sent, "WETH_WITHDRAW_FAILED");
        emit Withdrawal(msg.sender, wad);
    }

    receive() external payable {
        _balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "WETH_ALLOWANCE");
        allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(_balances[from] >= amount, "WETH_BALANCE");
        _balances[from] -= amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract MockUniswapV3Pool is IUniswapV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    uint160 public sqrtPriceX96Stored;

    constructor(address token0_, address token1_, uint24 fee_) {
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
    }

    function slot0()
        external
        view
        override
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (sqrtPriceX96Stored, 0, 0, 0, 0, 0, sqrtPriceX96Stored != 0);
    }

    function initialize(uint160 sqrtPriceX96) external override {
        require(sqrtPriceX96Stored == 0, "ALREADY_INITIALIZED");
        require(sqrtPriceX96 != 0, "ZERO_PRICE");
        sqrtPriceX96Stored = sqrtPriceX96;
    }

    /// @dev Test-only: simulates a swap moving the pool's price, permissionless
    ///      like a real Uniswap V3 pool's swaps would be. Used both to rig a
    ///      pool at an attacker-chosen price before graduation and to simulate
    ///      arbitrage correcting a rigged pool back within tolerance.
    function setSqrtPriceX96(uint160 sqrtPriceX96) external {
        require(sqrtPriceX96Stored != 0, "NOT_INITIALIZED");
        require(sqrtPriceX96 != 0, "ZERO_PRICE");
        sqrtPriceX96Stored = sqrtPriceX96;
    }
}

contract MockUniswapV3Factory is IUniswapV3Factory {
    mapping(bytes32 => address) public pools;

    function getPool(address tokenA, address tokenB, uint24 fee) external view override returns (address pool) {
        pool = pools[_key(tokenA, tokenB, fee)];
    }

    function createPool(address tokenA, address tokenB, uint24 fee) external override returns (address pool) {
        bytes32 key = _key(tokenA, tokenB, fee);
        require(pools[key] == address(0), "POOL_EXISTS");
        require(tokenA != tokenB, "IDENTICAL_TOKENS");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pool = address(new MockUniswapV3Pool(token0, token1, fee));
        pools[key] = pool;
    }

    /// @dev Only the 1% (10_000) tier the curve uses is enabled, matching
    ///      the real Uniswap V3 factory's per-fee tick-spacing lookup.
    function feeAmountTickSpacing(uint24 fee) external pure override returns (int24) {
        if (fee == 10_000) return 200;
        return 0;
    }

    function _key(address tokenA, address tokenB, uint24 fee) internal pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1, fee));
    }
}

contract MockNonfungiblePositionManager is INonfungiblePositionManager {
    struct MintedPosition {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0;
        uint256 amount1;
        address recipient;
    }

    uint256 public nextTokenId = 1;
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => MintedPosition) public positions;

    /// @dev Fraction (out of 10_000) of each side's `amountDesired` this mock
    ///      actually consumes, simulating a mispriced pool that only accepts
    ///      part of the deposit. Defaults to full consumption.
    uint256 public consumptionBps = 10_000;

    function setConsumptionBps(uint256 bps) external {
        require(bps <= 10_000, "BPS_TOO_HIGH");
        consumptionBps = bps;
    }

    function mint(MintParams calldata params)
        external
        payable
        override
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        require(params.recipient != address(0), "ZERO_RECIPIENT");
        require(params.deadline >= block.timestamp, "EXPIRED");
        require(params.tickLower < params.tickUpper, "BAD_TICK_RANGE");

        amount0 = (params.amount0Desired * consumptionBps) / 10_000;
        amount1 = (params.amount1Desired * consumptionBps) / 10_000;
        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "SLIPPAGE");

        _pullToken(params.token0, amount0);
        _pullToken(params.token1, amount1);

        tokenId = nextTokenId++;
        ownerOf[tokenId] = params.recipient;
        liquidity = uint128(amount0 + amount1);
        positions[tokenId] = MintedPosition(
            params.token0,
            params.token1,
            params.fee,
            params.tickLower,
            params.tickUpper,
            amount0,
            amount1,
            params.recipient
        );
    }

    function _pullToken(address tokenAddr, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, bytes memory data) = tokenAddr.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "PULL_FAILED");
    }
}

/// @dev Always reverts on mint(), used to prove a failed Uniswap call
///      aborts the whole graduation instead of partially completing it.
contract FailingNonfungiblePositionManager is INonfungiblePositionManager {
    error MintAlwaysFails();

    function mint(MintParams calldata)
        external
        payable
        override
        returns (uint256, uint128, uint256, uint256)
    {
        revert MintAlwaysFails();
    }
}

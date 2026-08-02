// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {INonfungiblePositionManagerMinimal} from "../HoodlumsTestBondingCurve.sol";

/// @dev Test doubles for the Uniswap V3 contracts HoodlumsTestBondingCurve
///      integrates with. None of these are deployed on the Hardhat test
///      network, so `_graduate()` is exercised entirely against these mocks.
///      `MintParams` is imported directly from the production interface so
///      the mocks' ABI can never silently drift from what the curve encodes.

interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev Minimal WETH9: 1:1 native-currency wrapping plus standard ERC-20
///      approve/transfer/transferFrom, matching what `_graduate()` calls.
contract MockWETH9 {
    string public constant name = "Wrapped Ether";
    string public constant symbol = "WETH";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
        emit Transfer(address(0), msg.sender, msg.value);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "WETH_ALLOWANCE");
            allowance[from][msg.sender] = allowed - amount;
        }
        require(balanceOf[from] >= amount, "WETH_BALANCE");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @dev Tracks only what `_graduate()` reads/writes: whether `initialize()`
///      has been called once, matching the real pool's "already initialized" guard.
contract MockUniswapV3Pool {
    uint160 public sqrtPriceX96;

    function initialize(uint160 sqrtPriceX96_) external {
        require(sqrtPriceX96 == 0, "ALREADY_INITIALIZED");
        require(sqrtPriceX96_ != 0, "ZERO_PRICE");
        sqrtPriceX96 = sqrtPriceX96_;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }
}

/// @dev Order-independent pool registry, mirroring the real factory's
///      `getPool`/`createPool` behavior (including that the token/WETH order
///      passed in does not have to match the canonical token0/token1 order).
contract MockUniswapV3Factory {
    mapping(bytes32 => address) public pools;

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        return pools[_key(tokenA, tokenB, fee)];
    }

    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool) {
        bytes32 key = _key(tokenA, tokenB, fee);
        require(pools[key] == address(0), "POOL_EXISTS");
        pool = address(new MockUniswapV3Pool());
        pools[key] = pool;
    }

    function _key(address tokenA, address tokenB, uint24 fee) internal pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(token0, token1, fee));
    }
}

/// @dev Pulls `amount0Desired`/`amount1Desired` via `transferFrom`, mirroring
///      the real position manager, then mints an incrementing LP NFT id to
///      `params.recipient`. Ownership is tracked so `safeTransferFrom` can
///      prove the LP NFT actually moves to `LP_LOCK_ADDRESS`.
contract MockNonfungiblePositionManager {
    uint256 public nextTokenId = 1;
    mapping(uint256 => address) public ownerOf;

    function mint(INonfungiblePositionManagerMinimal.MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        require(params.deadline >= block.timestamp, "EXPIRED");
        require(params.tickLower < params.tickUpper, "BAD_RANGE");

        if (params.amount0Desired > 0) {
            require(
                IERC20Like(params.token0).transferFrom(msg.sender, address(this), params.amount0Desired),
                "PULL_TOKEN0"
            );
        }
        if (params.amount1Desired > 0) {
            require(
                IERC20Like(params.token1).transferFrom(msg.sender, address(this), params.amount1Desired),
                "PULL_TOKEN1"
            );
        }

        tokenId = nextTokenId++;
        ownerOf[tokenId] = params.recipient;
        liquidity = 1;
        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        require(ownerOf[tokenId] == from, "NOT_OWNER");
        require(to != address(0), "ZERO_RECIPIENT");
        ownerOf[tokenId] = to;
    }
}

/// @dev Always reverts on `mint()`, used to prove a failed Uniswap call
///      reverts the entire graduation instead of partially completing.
contract FailingNonfungiblePositionManager {
    error MintAlwaysFails();

    function mint(INonfungiblePositionManagerMinimal.MintParams calldata)
        external
        payable
        returns (uint256, uint128, uint256, uint256)
    {
        revert MintAlwaysFails();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert MintAlwaysFails();
    }
}

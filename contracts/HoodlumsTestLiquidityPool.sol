// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract HoodlumsTestLiquidityPool {
    string public constant name = "Hoodlums Test LP";
    string public constant symbol = "HTLP";
    uint8 public constant decimals = 18;
    uint256 public constant FEE_BPS = 30;
    uint256 public constant BPS = 10_000;
    uint256 private constant MINIMUM_LIQUIDITY = 1_000;

    address public immutable token;
    uint112 public reserveToken;
    uint112 public reserveEth;
    uint32 public blockTimestampLast;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 private unlocked = 1;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event LiquidityAdded(address indexed provider, uint256 tokenAmount, uint256 ethAmount, uint256 lpMinted);
    event LiquidityRemoved(address indexed provider, uint256 tokenAmount, uint256 ethAmount, uint256 lpBurned);
    event Swap(address indexed trader, bool ethToToken, uint256 amountIn, uint256 amountOut);
    event Sync(uint112 reserveToken, uint112 reserveEth);

    modifier lock() {
        require(unlocked == 1, "LOCKED");
        unlocked = 0;
        _;
        unlocked = 1;
    }

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "EXPIRED");
        _;
    }

    constructor(address token_) {
        require(token_ != address(0), "TOKEN_ZERO");
        token = token_;
    }

    receive() external payable {
        revert("USE_FUNCTION");
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "LP_ALLOWANCE");
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function addLiquidity(uint256 tokenDesired, uint256 tokenMin, uint256 ethMin, uint256 minLp, uint256 deadline)
        external
        payable
        lock
        ensure(deadline)
        returns (uint256 tokenAmount, uint256 ethAmount, uint256 liquidity)
    {
        require(tokenDesired > 0 && msg.value > 0, "ZERO_INPUT");
        if (totalSupply == 0) {
            tokenAmount = tokenDesired;
            ethAmount = msg.value;
        } else {
            uint256 optimalToken = (msg.value * reserveToken) / reserveEth;
            if (optimalToken <= tokenDesired) {
                tokenAmount = optimalToken;
                ethAmount = msg.value;
            } else {
                uint256 optimalEth = (tokenDesired * reserveEth) / reserveToken;
                require(optimalEth <= msg.value, "BAD_RATIO");
                tokenAmount = tokenDesired;
                ethAmount = optimalEth;
            }
        }
        require(tokenAmount >= tokenMin && ethAmount >= ethMin, "SLIPPAGE");
        _safeTransferFrom(token, msg.sender, address(this), tokenAmount);
        if (msg.value > ethAmount) _safeTransferEth(msg.sender, msg.value - ethAmount);

        if (totalSupply == 0) {
            uint256 root = _sqrt(tokenAmount * ethAmount);
            require(root > MINIMUM_LIQUIDITY, "LOW_INITIAL_LIQ");
            _mint(address(1), MINIMUM_LIQUIDITY);
            liquidity = root - MINIMUM_LIQUIDITY;
        } else {
            liquidity = _min((tokenAmount * totalSupply) / reserveToken, (ethAmount * totalSupply) / reserveEth);
        }
        require(liquidity >= minLp && liquidity > 0, "LOW_LP");
        _mint(msg.sender, liquidity);
        _update();
        emit LiquidityAdded(msg.sender, tokenAmount, ethAmount, liquidity);
    }

    function removeLiquidity(uint256 liquidity, uint256 tokenMin, uint256 ethMin, uint256 deadline)
        external
        lock
        ensure(deadline)
        returns (uint256 tokenAmount, uint256 ethAmount)
    {
        require(liquidity > 0 && balanceOf[msg.sender] >= liquidity, "LOW_LP_BALANCE");
        tokenAmount = (liquidity * reserveToken) / totalSupply;
        ethAmount = (liquidity * reserveEth) / totalSupply;
        require(tokenAmount >= tokenMin && ethAmount >= ethMin, "SLIPPAGE");
        _burn(msg.sender, liquidity);
        _safeTransfer(token, msg.sender, tokenAmount);
        _safeTransferEth(msg.sender, ethAmount);
        _update();
        emit LiquidityRemoved(msg.sender, tokenAmount, ethAmount, liquidity);
    }

    function swapExactEthForTokens(uint256 minTokensOut, uint256 deadline)
        external
        payable
        lock
        ensure(deadline)
        returns (uint256 tokensOut)
    {
        require(msg.value > 0 && reserveToken > 0 && reserveEth > 0, "NO_LIQUIDITY");
        tokensOut = getAmountOut(msg.value, reserveEth, reserveToken);
        require(tokensOut >= minTokensOut && tokensOut < reserveToken, "SLIPPAGE");
        _safeTransfer(token, msg.sender, tokensOut);
        _update();
        emit Swap(msg.sender, true, msg.value, tokensOut);
    }

    function swapExactTokensForEth(uint256 tokensIn, uint256 minEthOut, uint256 deadline)
        external
        lock
        ensure(deadline)
        returns (uint256 ethOut)
    {
        require(tokensIn > 0 && reserveToken > 0 && reserveEth > 0, "NO_LIQUIDITY");
        ethOut = getAmountOut(tokensIn, reserveToken, reserveEth);
        require(ethOut >= minEthOut && ethOut < reserveEth, "SLIPPAGE");
        _safeTransferFrom(token, msg.sender, address(this), tokensIn);
        _safeTransferEth(msg.sender, ethOut);
        _update();
        emit Swap(msg.sender, false, tokensIn, ethOut);
    }

    function quoteTokenForEth(uint256 tokensIn) external view returns (uint256) {
        return getAmountOut(tokensIn, reserveToken, reserveEth);
    }

    function quoteEthForToken(uint256 ethIn) external view returns (uint256) {
        return getAmountOut(ethIn, reserveEth, reserveToken);
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        require(amountIn > 0 && reserveIn > 0 && reserveOut > 0, "BAD_QUOTE");
        uint256 amountInWithFee = amountIn * (BPS - FEE_BPS);
        return (amountInWithFee * reserveOut) / (reserveIn * BPS + amountInWithFee);
    }

    function _update() internal {
        uint256 tokenBalance = _tokenBalance();
        uint256 ethBalance = address(this).balance;
        require(tokenBalance <= type(uint112).max && ethBalance <= type(uint112).max, "OVERFLOW");
        reserveToken = uint112(tokenBalance);
        reserveEth = uint112(ethBalance);
        blockTimestampLast = uint32(block.timestamp);
        emit Sync(reserveToken, reserveEth);
    }

    function _tokenBalance() internal view returns (uint256 balance) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(ok && data.length >= 32, "BALANCE_FAILED");
        balance = abi.decode(data, (uint256));
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "TO_ZERO");
        require(balanceOf[from] >= amount, "LP_BALANCE");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _safeTransfer(address erc20, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = erc20.call(abi.encodeWithSelector(IERC20Like.transfer.selector, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TOKEN_TRANSFER");
    }

    function _safeTransferFrom(address erc20, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = erc20.call(abi.encodeWithSelector(IERC20Like.transferFrom.selector, from, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TOKEN_TRANSFER_FROM");
    }

    function _safeTransferEth(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount}("");
        require(ok, "ETH_TRANSFER");
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}

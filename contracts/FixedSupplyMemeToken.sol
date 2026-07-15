// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @notice Fixed-supply ERC-20 used by the private testnet launcher.
/// @dev There is no owner and no external mint function. The complete supply is
/// minted to the wallet-selected recipient in the constructor.
contract FixedSupplyMemeToken is ERC20, ERC20Burnable {
    uint8 private immutable _tokenDecimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 wholeTokenSupply_,
        uint8 decimals_,
        address recipient_
    ) ERC20(name_, symbol_) {
        require(bytes(name_).length >= 2 && bytes(name_).length <= 32, "Invalid name");
        require(bytes(symbol_).length >= 2 && bytes(symbol_).length <= 12, "Invalid symbol");
        require(wholeTokenSupply_ > 0, "Supply must be positive");
        require(decimals_ <= 18, "Decimals too high");
        require(recipient_ != address(0), "Invalid recipient");

        _tokenDecimals = decimals_;
        _mint(recipient_, wholeTokenSupply_ * (10 ** uint256(decimals_)));
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FixedSupplyMemeToken} from "./FixedSupplyMemeToken.sol";

/// @notice Testnet-first factory for fixed-supply Hoodlums launches.
/// @dev Launch fees default to zero. Mainnet use requires a separate audited deployment.
contract HoodlumsTokenFactory is Ownable2Step, ReentrancyGuard {
    uint256 public constant MAX_LAUNCH_FEE = 0.1 ether;

    struct LaunchRecord {
        address token;
        address creator;
        address recipient;
        uint256 wholeTokenSupply;
        uint256 feePaid;
        uint64 launchedAt;
        uint8 decimals;
    }

    error InvalidAddress();
    error IncorrectLaunchFee(uint256 expected, uint256 received);
    error LaunchFeeTooHigh(uint256 requested, uint256 maximum);
    error FeeTransferFailed();
    error DirectPaymentNotAccepted();
    error LaunchIndexOutOfBounds();

    event TokenLaunched(
        uint256 indexed launchIndex,
        address indexed token,
        address indexed creator,
        address recipient,
        string name,
        string symbol,
        uint256 wholeTokenSupply,
        uint8 decimals,
        uint256 feePaid
    );
    event LaunchFeeUpdated(uint256 previousFee, uint256 newFee);
    event FeeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);

    uint256 public launchFee;
    address public feeRecipient;

    address[] private _allTokens;
    mapping(address creator => address[] tokens) private _creatorTokens;
    mapping(address token => LaunchRecord record) public launches;
    mapping(address token => bool createdByFactory) public isFactoryToken;

    constructor(
        address initialOwner,
        address initialFeeRecipient,
        uint256 initialLaunchFee
    ) Ownable(initialOwner) {
        if (initialOwner == address(0) || initialFeeRecipient == address(0)) {
            revert InvalidAddress();
        }
        if (initialLaunchFee > MAX_LAUNCH_FEE) {
            revert LaunchFeeTooHigh(initialLaunchFee, MAX_LAUNCH_FEE);
        }

        feeRecipient = initialFeeRecipient;
        launchFee = initialLaunchFee;
    }

    /// @notice Deploy a fixed-supply token and record the launch on-chain.
    /// @param recipient Wallet that receives the complete token supply.
    function launchToken(
        string calldata name,
        string calldata symbol,
        uint256 wholeTokenSupply,
        uint8 decimals,
        address recipient
    ) external payable nonReentrant returns (address tokenAddress) {
        uint256 requiredFee = launchFee;
        if (msg.value != requiredFee) {
            revert IncorrectLaunchFee(requiredFee, msg.value);
        }
        if (recipient == address(0)) revert InvalidAddress();

        FixedSupplyMemeToken token = new FixedSupplyMemeToken(
            name,
            symbol,
            wholeTokenSupply,
            decimals,
            recipient
        );
        tokenAddress = address(token);

        uint256 launchIndex = _allTokens.length;
        LaunchRecord memory record = LaunchRecord({
            token: tokenAddress,
            creator: msg.sender,
            recipient: recipient,
            wholeTokenSupply: wholeTokenSupply,
            feePaid: requiredFee,
            launchedAt: uint64(block.timestamp),
            decimals: decimals
        });

        _allTokens.push(tokenAddress);
        _creatorTokens[msg.sender].push(tokenAddress);
        launches[tokenAddress] = record;
        isFactoryToken[tokenAddress] = true;

        if (requiredFee != 0) {
            (bool sent, ) = payable(feeRecipient).call{value: requiredFee}("");
            if (!sent) revert FeeTransferFailed();
        }

        emit TokenLaunched(
            launchIndex,
            tokenAddress,
            msg.sender,
            recipient,
            name,
            symbol,
            wholeTokenSupply,
            decimals,
            requiredFee
        );
    }

    function setLaunchFee(uint256 newFee) external onlyOwner {
        if (newFee > MAX_LAUNCH_FEE) {
            revert LaunchFeeTooHigh(newFee, MAX_LAUNCH_FEE);
        }

        uint256 previousFee = launchFee;
        launchFee = newFee;
        emit LaunchFeeUpdated(previousFee, newFee);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert InvalidAddress();

        address previousRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(previousRecipient, newRecipient);
    }

    function launchCount() external view returns (uint256) {
        return _allTokens.length;
    }

    function launchAt(uint256 index) external view returns (LaunchRecord memory) {
        if (index >= _allTokens.length) revert LaunchIndexOutOfBounds();
        return launches[_allTokens[index]];
    }

    function creatorLaunchCount(address creator) external view returns (uint256) {
        return _creatorTokens[creator].length;
    }

    function creatorLaunchAt(
        address creator,
        uint256 index
    ) external view returns (LaunchRecord memory) {
        if (index >= _creatorTokens[creator].length) revert LaunchIndexOutOfBounds();
        return launches[_creatorTokens[creator][index]];
    }

    receive() external payable {
        revert DirectPaymentNotAccepted();
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FixedSupplyMemeToken} from "./FixedSupplyMemeToken.sol";
import {HoodlumsTestBondingCurve} from "./HoodlumsTestBondingCurve.sol";

/// @notice Testnet-only helper that deploys a fixed-supply token and its
///         bonding curve together in a single transaction (Milestone A,
///         issue #409), so a creator only needs to `approve()` the curve and
///         call `fundCurve()` afterward before trading opens — two wallet
///         signatures instead of separately deploying the token, deploying
///         the curve, then approving and funding.
/// @dev Neither `FixedSupplyMemeToken` nor `HoodlumsTestBondingCurve` is
///      modified: this contract only chains their existing constructors, so
///      the curve's already-reviewed fee/graduation economics (rule 5) and
///      `fundCurve()`'s `onlyCreator` + complete-supply invariant (rule 6)
///      are unchanged. `msg.sender` of `launchTokenWithCurve` becomes both
///      the token's initial recipient and the curve's immutable `creator`,
///      so creator fee withdrawals always go to the real launching wallet —
///      never to this contract, which never holds the token or any funds.
///      Bypasses `HoodlumsTokenFactory` entirely rather than routing through
///      it: forwarding a launch through this contract would make the
///      factory's own `creator`/`isFactoryToken` bookkeeping and
///      `TokenLaunched` event report this contract as the launcher instead
///      of the real wallet, which would break server-side reconciliation of
///      `token_launches` against on-chain proof. Nothing elsewhere in the
///      app gates on `isFactoryToken`, so a curve-backed launch simply not
///      being a "factory token" is safe.
contract HoodlumsCurveLaunchPipeline is ReentrancyGuard {
    address public immutable treasury;
    address public immutable positionManager;
    address public immutable uniswapV3Factory;
    address public immutable weth9;

    error InvalidAddress();

    event TokenAndCurveLaunched(
        address indexed token,
        address indexed curve,
        address indexed creator,
        uint256 wholeTokenSupply,
        uint8 decimals,
        uint256 graduationTarget
    );

    constructor(
        address treasury_,
        address positionManager_,
        address uniswapV3Factory_,
        address weth9_
    ) {
        if (
            treasury_ == address(0) ||
            positionManager_ == address(0) ||
            uniswapV3Factory_ == address(0) ||
            weth9_ == address(0)
        ) {
            revert InvalidAddress();
        }

        treasury = treasury_;
        positionManager = positionManager_;
        uniswapV3Factory = uniswapV3Factory_;
        weth9 = weth9_;
    }

    /// @notice Deploys a fixed-supply token (full supply minted to the
    ///         caller) and a `HoodlumsTestBondingCurve` for it, with this
    ///         contract's configured `treasury`/Uniswap addresses.
    /// @dev This contract never receives, approves, or moves the token — the
    ///      caller must still `approve()` the returned `curve` for the
    ///      token's full supply and call `curve.fundCurve()` themselves.
    ///      `nonReentrant` is defense in depth: neither constructor below
    ///      makes an external call to attacker-influenced code.
    function launchTokenWithCurve(
        string calldata name,
        string calldata symbol,
        uint256 wholeTokenSupply,
        uint8 decimals,
        uint256 virtualTokenReserve,
        uint256 virtualEthReserve,
        uint256 graduationTarget
    ) external nonReentrant returns (address token, address curve) {
        FixedSupplyMemeToken deployed = new FixedSupplyMemeToken(
            name,
            symbol,
            wholeTokenSupply,
            decimals,
            msg.sender
        );
        token = address(deployed);

        curve = address(
            new HoodlumsTestBondingCurve(
                token,
                msg.sender,
                treasury,
                virtualTokenReserve,
                virtualEthReserve,
                graduationTarget,
                positionManager,
                uniswapV3Factory,
                weth9
            )
        );

        emit TokenAndCurveLaunched(token, curve, msg.sender, wholeTokenSupply, decimals, graduationTarget);
    }
}

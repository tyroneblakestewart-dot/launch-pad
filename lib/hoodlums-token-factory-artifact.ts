import { parseAbi } from "viem";

/**
 * ABI + creation bytecode for contracts/HoodlumsTokenFactory.sol.
 *
 * Only the constructor and the read functions the factory-setup panel needs
 * (owner, feeRecipient, launchFee, launchCount) are included here — see
 * contracts/HoodlumsTokenFactory.sol for the full contract surface.
 * launchToken() is intentionally omitted: public launches are not routed
 * through the factory yet.
 *
 * HOODLUMS_TOKEN_FACTORY_BYTECODE is generated, not hand-written — regenerate
 * it with:
 *   npm run contracts:compile
 *   npm run contracts:factory-artifact
 * (scripts/generate-hoodlums-token-factory-artifact.mjs reads the Hardhat
 * compile output and rewrites this file.) It ships empty in this change
 * because it was authored in a sandbox that could not run npm/Hardhat — see
 * the pull request description. HOODLUMS_TOKEN_FACTORY_ARTIFACT_READY
 * reflects that, and the deploy panel refuses to deploy until this file is
 * regenerated with a real bytecode value.
 */
export const HOODLUMS_TOKEN_FACTORY_ABI = parseAbi([
  "constructor(address initialOwner, address initialFeeRecipient, uint256 initialLaunchFee)",
  "function owner() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function launchFee() view returns (uint256)",
  "function launchCount() view returns (uint256)",
]);

export const HOODLUMS_TOKEN_FACTORY_BYTECODE = "0x" as `0x${string}`;

export const HOODLUMS_TOKEN_FACTORY_ARTIFACT_READY =
  HOODLUMS_TOKEN_FACTORY_BYTECODE.length > 2;

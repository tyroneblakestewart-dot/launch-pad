import { parseEventLogs, type Address, type Log } from "viem";
import { HOODLUMS_TOKEN_FACTORY_ABI } from "./factory-config";

/**
 * Reads the created token address out of a confirmed launchToken() receipt's
 * logs by decoding the factory's TokenLaunched event, rather than trusting a
 * contractAddress field (launchToken calls new inside the factory, so the
 * receipt itself has none).
 */
export function extractLaunchedTokenAddress(logs: Log[]): Address | undefined {
  const events = parseEventLogs({
    abi: HOODLUMS_TOKEN_FACTORY_ABI,
    eventName: "TokenLaunched",
    logs,
  });
  return events[0]?.args.token;
}

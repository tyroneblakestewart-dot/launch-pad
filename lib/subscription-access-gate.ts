import type { SubscriptionAccess } from "@/lib/subscription-lifecycle";

export type SubscriptionGateState =
  | "checking"
  | "disconnected"
  | "unlocked"
  | "paywall"
  | "unavailable";

/**
 * A successful server response is the only input allowed to unlock the
 * workspace or show its paywall. Client/session flags never grant access.
 */
export function subscriptionGateStateFromServer(
  access: SubscriptionAccess,
): Extract<SubscriptionGateState, "unlocked" | "paywall"> {
  return access.active ? "unlocked" : "paywall";
}

import { isAddress } from "viem";
import { getPostgresPool } from "@/lib/server/postgres";
import { getSubscriptionAccess, type SubscriptionQuery } from "@/lib/server/subscription-lifecycle";

/**
 * The AI Social Studio page (`/social`) is already wrapped in
 * `SubscriptionAccessGate`, which shows this exact upsell copy client-side
 * for any wallet without an active Pro or Pro Bundle subscription. Every
 * server route that spends AI tokens on behalf of the studio re-checks the
 * same wallet against the same canonical `getSubscriptionAccess` decision
 * before calling a provider — the client-side gate is a UX convenience, not
 * the security boundary. Scoped to Pro/Pro Bundle only, matching the gate;
 * Bond + Pro Site is a one-off bespoke-site entitlement, not a Social
 * Studio one.
 */
export const SOCIAL_STUDIO_UPSELL_MESSAGE =
  "AI Social Studio tools are included with Pro and Pro Bundle. Connect the wallet with an active subscription, or upgrade from your account.";

export type SocialStudioAuthorisation =
  | {
      status: "allowed";
      walletAddress: string;
      /** Real server authorisations include this (issue #368); optional keeps older injected test fixtures compatible. */
      accessSource?: "paid" | "test-allowlist";
    }
  | { status: "upsell"; message: string }
  | { status: "invalid-wallet"; message: string }
  | { status: "unavailable"; message: string };

export type SocialStudioAuthoriser = (
  walletAddress: unknown,
  options?: { databaseUrl?: string; query?: SubscriptionQuery; now?: Date },
) => Promise<SocialStudioAuthorisation>;

let testAuthoriser: SocialStudioAuthoriser | null = null;

/** Test seam mirroring setBespokeSiteAuthoriserForTests — see tests/setup.ts for the default fixture. */
export function setSocialStudioAuthoriserForTests(authoriser: SocialStudioAuthoriser): void {
  testAuthoriser = authoriser;
}

export function resetSocialStudioAuthoriserForTests(): void {
  testAuthoriser = null;
}

export async function authoriseSocialStudioRequest(
  walletAddress: unknown,
  options: { databaseUrl?: string; query?: SubscriptionQuery; now?: Date } = {},
): Promise<SocialStudioAuthorisation> {
  if (process.env.NODE_ENV === "test" && testAuthoriser) {
    return testAuthoriser(walletAddress, options);
  }

  const normalised = typeof walletAddress === "string" ? walletAddress.trim() : "";
  if (!normalised || !isAddress(normalised)) {
    return {
      status: "invalid-wallet",
      message: "Connect a valid wallet before using AI Social Studio tools.",
    };
  }

  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl && !options.query) {
    return {
      status: "unavailable",
      message: "Subscription access could not be checked. No AI request was made.",
    };
  }

  const baseQuery =
    options.query ??
    (((text: string, params?: unknown[]) => getPostgresPool(databaseUrl).query(text, params)) as SubscriptionQuery);

  // getSubscriptionAccess swallows any query failure into the same "empty/
  // inactive" shape as a genuinely free wallet, which would otherwise read
  // as an upsell instead of a real outage. Wrap the query so a thrown error
  // is distinguishable and reported as "unavailable" (fail closed, no silent
  // upsell) rather than a misleading "you're not subscribed".
  let queryError: unknown = null;
  const query = (async (text: string, params?: unknown[]) => {
    try {
      return await baseQuery(text, params);
    } catch (error) {
      queryError = error;
      throw error;
    }
  }) as SubscriptionQuery;

  const access = await getSubscriptionAccess(normalised, { query, now: options.now });
  if (queryError) {
    return {
      status: "unavailable",
      message: "Subscription access could not be checked. No AI request was made.",
    };
  }
  if (!access.active) {
    return { status: "upsell", message: SOCIAL_STUDIO_UPSELL_MESSAGE };
  }

  return {
    status: "allowed",
    walletAddress: access.walletAddress,
    accessSource: access.accessSource === "test-allowlist" ? "test-allowlist" : "paid",
  };
}

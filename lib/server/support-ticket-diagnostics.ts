import { getClientErrorStore } from "@/lib/server/client-errors-store";
import { getPostgresPool } from "@/lib/server/postgres";
import { getSocialConnectionsStore } from "@/lib/server/social-connections-store";
import { getSubscriptionAccess, type SubscriptionQuery } from "@/lib/server/subscription-lifecycle";

// Assembles the server-side-only diagnostics snapshot attached to a support
// ticket at creation time (issue #393). Every field here comes from a
// server read, never from the client request body, and never includes
// credentials, encrypted blobs, tokens, secrets or reconnect payloads —
// social connections are reduced to platform+status only, the same shape
// already returned by GET /api/social/connections.

const RECENT_CLIENT_ERROR_WINDOW_MS = 24 * 60 * 60 * 1000;

export type SupportTicketPlanDiagnostics =
  | { status: "checked"; plan: string | null; subscriptionStatus: string; active: boolean; accessSource: string }
  | { status: "unavailable" };

export type SupportTicketDiagnostics = {
  plan: SupportTicketPlanDiagnostics;
  socialConnections: Array<{ platform: string; status: string }>;
  recentClientErrorCount: number | null;
};

export type BuildSupportTicketDiagnosticsOptions = {
  now?: Date;
  /** Test seam mirroring authoriseSocialStudioRequest's `query` override — bypasses needing a real Postgres instance. */
  query?: SubscriptionQuery;
  databaseUrl?: string;
};

export async function buildSupportTicketDiagnostics(
  walletAddress: string,
  options: BuildSupportTicketDiagnosticsOptions = {},
): Promise<SupportTicketDiagnostics> {
  const now = options.now ?? new Date();
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";

  let plan: SupportTicketPlanDiagnostics = { status: "unavailable" };
  if (!options.query && !databaseUrl) {
    plan = { status: "unavailable" };
  } else {
    // getSubscriptionAccess swallows a query failure into the same
    // "empty/inactive" shape as a genuinely free wallet (see
    // social-studio-entitlement.ts's identical wrapper), which would
    // otherwise read as "no plan" instead of "could not check". Wrap the
    // query so a thrown error is distinguishable here too.
    let queryError: unknown = null;
    const baseQuery = options.query ?? ((text: string, params?: unknown[]) => getPostgresPool(databaseUrl).query(text, params));
    const query = (async (text: string, params?: unknown[]) => {
      try {
        return await baseQuery(text, params);
      } catch (error) {
        queryError = error;
        throw error;
      }
    }) as SubscriptionQuery;

    try {
      const access = await getSubscriptionAccess(walletAddress, { query, now });
      plan = queryError
        ? { status: "unavailable" }
        : {
            status: "checked",
            plan: access.plan,
            subscriptionStatus: access.status,
            active: access.active,
            accessSource: access.accessSource,
          };
    } catch {
      plan = { status: "unavailable" };
    }
  }

  let socialConnections: Array<{ platform: string; status: string }> = [];
  try {
    const connections = await getSocialConnectionsStore().list(walletAddress);
    socialConnections = connections.map((connection) => ({ platform: connection.platform, status: connection.status }));
  } catch {
    socialConnections = [];
  }

  let recentClientErrorCount: number | null = null;
  try {
    const since = new Date(now.getTime() - RECENT_CLIENT_ERROR_WINDOW_MS);
    recentClientErrorCount = await getClientErrorStore().countRecentForWallet(walletAddress, since);
  } catch {
    recentClientErrorCount = null;
  }

  return { plan, socialConnections, recentClientErrorCount };
}

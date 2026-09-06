import { NextResponse } from "next/server";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { AdminSessionStoreUnavailableError, isAdminSessionValid } from "@/lib/server/admin-session-store";
import { UserAccountsStoreUnavailableError, getUserAccountsStore } from "@/lib/server/user-accounts-store";

// Read-only admin listing of Google sign-in accounts (phase 1, 6 Sep 2026,
// rule 10). Mirrors app/api/admin/token-launches/route.ts. Returns email,
// linked wallet and sign-in times — never the Google id.

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const ADMIN_LIST_LIMIT = 200;

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(token && (await isAdminSessionValid(hashAdminSessionToken(token))));
}

export async function GET(request: Request) {
  try {
    if (!(await isAuthenticated(request))) {
      return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401, headers: NO_STORE_HEADERS });
    }
    const store = getUserAccountsStore();
    const [accounts, counts] = await Promise.all([store.listForAdmin(ADMIN_LIST_LIMIT), store.counts()]);
    return NextResponse.json(
      {
        counts,
        accounts: accounts.map((account) => ({
          id: account.id,
          email: account.email,
          emailVerified: account.emailVerified,
          displayName: account.displayName,
          linkedWalletAddress: account.linkedWalletAddress,
          walletLinkedAt: account.walletLinkedAt,
          lastSignInAt: account.lastSignInAt,
          createdAt: account.createdAt,
        })),
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof UserAccountsStoreUnavailableError) {
      return NextResponse.json({ error: "Account storage is not ready. Apply the latest database migrations and try again." }, { status: 503, headers: NO_STORE_HEADERS });
    }
    console.error("Admin Google accounts listing failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "Accounts could not be loaded. Try again." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

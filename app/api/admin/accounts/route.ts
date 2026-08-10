import { NextResponse } from "next/server";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import {
  AdminSessionStoreUnavailableError,
  isAdminSessionValid,
} from "@/lib/server/admin-session-store";
import {
  AdminAccountsUnavailableError,
  searchAdminAccounts,
} from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(token && (await isAdminSessionValid(hashAdminSessionToken(token))));
}

function positiveNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: Request) {
  try {
    if (!(await isAuthenticated(request))) {
      return NextResponse.json(
        { error: "Admin sign-in is required." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const url = new URL(request.url);
    const response = await searchAdminAccounts({
      query: url.searchParams.get("q") || "",
      page: positiveNumber(url.searchParams.get("page")),
      pageSize: positiveNumber(url.searchParams.get("pageSize")),
    });
    return NextResponse.json(response, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError) {
      return NextResponse.json(
        { error: "Admin session storage is not configured. Apply the database migrations and try again." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    if (error instanceof AdminAccountsUnavailableError) {
      return NextResponse.json(
        { error: error.message },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    console.error(
      "Admin account search failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json(
      { error: "Account records could not be searched. Try again." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

import { NextResponse } from "next/server";
import { isAdminRequestOriginAllowed } from "@/lib/server/api-protection";
import {
  hashAdminSessionToken,
  parseAdminSessionCookie,
} from "@/lib/server/admin-auth";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import {
  AdminSessionStoreUnavailableError,
  isAdminSessionValid,
} from "@/lib/server/admin-session-store";
import {
  TestAccessStoreUnavailableError,
  TestAccessWalletAlreadyExistsError,
  TestAccessWalletNotFoundError,
  addTestAccessWallet,
  listTestAccessWallets,
  revokeTestAccessWallet,
} from "@/lib/server/test-access";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(
    token && (await isAdminSessionValid(hashAdminSessionToken(token))),
  );
}

function storageUnavailableResponse(message?: string) {
  return NextResponse.json(
    {
      error:
        message ||
        "Test access is not ready. Apply migration 015_test_access_allowlist.sql and try again.",
    },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

function unexpectedError(error: unknown) {
  console.error(
    "Admin test-access request failed unexpectedly.",
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  return NextResponse.json(
    { error: "Test access could not be updated. Try again." },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: Request) {
  try {
    if (!(await isAuthenticated(request))) {
      return NextResponse.json(
        { error: "Admin sign-in is required." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const wallets = await listTestAccessWallets();
    return NextResponse.json(
      {
        wallets,
        activeCount: wallets.filter((wallet) => wallet.active).length,
        revokedCount: wallets.filter((wallet) => !wallet.active).length,
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError) {
      return storageUnavailableResponse(
        "Admin session storage is not configured. Apply the database migrations and try again.",
      );
    }
    if (error instanceof TestAccessStoreUnavailableError) {
      return storageUnavailableResponse(error.message);
    }
    return unexpectedError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return NextResponse.json(
        { error: "Admin request origin is not allowed." },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    if (!(await isAuthenticated(request))) {
      return NextResponse.json(
        { error: "Admin sign-in is required." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const wallet = await addTestAccessWallet({
      walletAddress: body?.walletAddress,
      label: body?.label,
    });

    await recordAdminActivityBestEffort({
      kind: "test-access-added",
      message: `TEST access added for ${wallet.walletAddress}: ${wallet.label}`,
    });

    return NextResponse.json(
      { wallet },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof TypeError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (error instanceof TestAccessWalletAlreadyExistsError) {
      return NextResponse.json(
        { error: error.message, wallet: error.wallet },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    if (
      error instanceof AdminSessionStoreUnavailableError ||
      error instanceof TestAccessStoreUnavailableError
    ) {
      return storageUnavailableResponse(error.message);
    }
    return unexpectedError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return NextResponse.json(
        { error: "Admin request origin is not allowed." },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    if (!(await isAuthenticated(request))) {
      return NextResponse.json(
        { error: "Admin sign-in is required." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const wallet = await revokeTestAccessWallet(body?.id);

    await recordAdminActivityBestEffort({
      kind: "test-access-revoked",
      message: `TEST access revoked for ${wallet.walletAddress}: ${wallet.label}`,
    });

    return NextResponse.json(
      { wallet },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof TypeError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (error instanceof TestAccessWalletNotFoundError) {
      return NextResponse.json(
        { error: error.message },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    if (
      error instanceof AdminSessionStoreUnavailableError ||
      error instanceof TestAccessStoreUnavailableError
    ) {
      return storageUnavailableResponse(error.message);
    }
    return unexpectedError(error);
  }
}

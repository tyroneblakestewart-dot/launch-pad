import { NextResponse } from "next/server";
import { isAdminServiceKey } from "@/lib/admin-operations";
import { isAdminRequestOriginAllowed } from "@/lib/server/api-protection";
import {
  hashAdminSessionToken,
  parseAdminSessionCookie,
} from "@/lib/server/admin-auth";
import {
  AdminOperationsStoreUnavailableError,
  getAdminOperationsStore,
} from "@/lib/server/admin-operations-store";
import { getAdminOperationsSnapshot } from "@/lib/server/admin-operations";
import {
  AdminSessionStoreUnavailableError,
  isAdminSessionValid,
} from "@/lib/server/admin-session-store";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(
    token && (await isAdminSessionValid(hashAdminSessionToken(token))),
  );
}

function isMissingOperationsMigration(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "42P01",
  );
}

function storageUnavailableResponse() {
  return NextResponse.json(
    {
      error:
        "Admin operations storage is not ready. Apply the latest database migrations and try again.",
    },
    { status: 503, headers: NO_STORE_HEADERS },
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

    const snapshot = await getAdminOperationsSnapshot();
    return NextResponse.json(snapshot, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    if (
      error instanceof AdminSessionStoreUnavailableError ||
      error instanceof AdminOperationsStoreUnavailableError ||
      isMissingOperationsMigration(error)
    ) {
      return storageUnavailableResponse();
    }
    console.error(
      "Admin operations snapshot failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json(
      { error: "Admin operations could not be loaded. Try again." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return NextResponse.json(
        { error: "Admin operations origin is not allowed." },
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
    if (!body || !isAdminServiceKey(body.serviceKey)) {
      return NextResponse.json(
        { error: "A valid service is required." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (typeof body.isolated !== "boolean") {
      return NextResponse.json(
        { error: "The isolation state must be true or false." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const suppliedReason =
      typeof body.reason === "string" ? body.reason.trim() : "";
    if (
      body.isolated &&
      (suppliedReason.length < 5 || suppliedReason.length > 300)
    ) {
      return NextResponse.json(
        {
          error:
            "Explain why the service is being isolated in 5 to 300 characters.",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (!body.isolated && suppliedReason.length > 300) {
      return NextResponse.json(
        { error: "The restoration note must be 300 characters or fewer." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const control = await getAdminOperationsStore().setServiceIsolation({
      key: body.serviceKey,
      isolated: body.isolated,
      reason:
        suppliedReason ||
        (body.isolated
          ? "Isolated by the administrator."
          : "Restored after administrator review."),
    });

    return NextResponse.json(
      { control },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (
      error instanceof AdminSessionStoreUnavailableError ||
      error instanceof AdminOperationsStoreUnavailableError ||
      isMissingOperationsMigration(error)
    ) {
      return storageUnavailableResponse();
    }
    console.error(
      "Admin service isolation update failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json(
      { error: "The service isolation state could not be changed." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

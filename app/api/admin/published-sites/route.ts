import { NextResponse } from "next/server";
import { isAdminRequestOriginAllowed } from "@/lib/server/api-protection";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { AdminSessionStoreUnavailableError, isAdminSessionValid } from "@/lib/server/admin-session-store";
import { isValidContractAddressFormat } from "@/lib/server/published-site-validation";
import { PublishStoreUnavailableError, getPublishStore } from "@/lib/server/publish-store";
import { validateSlug } from "@/lib/slug";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(token && (await isAdminSessionValid(hashAdminSessionToken(token))));
}

function storageUnavailableResponse() {
  return NextResponse.json(
    { error: "Durable publishing is not configured. Set DATABASE_URL and try again." },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

/**
 * Admin-only "attach a contract address" path (issue #286): publishing is a
 * single-use wallet-signed action with no edit path, so a site published
 * before its token launched (or with the wrong address typed in) has no way
 * to pick up the right address later. This lets an authenticated admin
 * correct it directly on the durable record, without a fresh signed
 * republish.
 */
export async function PATCH(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return NextResponse.json({ error: "Admin request origin is not allowed." }, { status: 403, headers: NO_STORE_HEADERS });
    }
    if (!(await isAuthenticated(request))) {
      return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
    const contractAddress = typeof body?.contractAddress === "string" ? body.contractAddress.trim() : "";

    if (!validateSlug(slug).valid) {
      return NextResponse.json({ error: "A valid site slug is required." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (!isValidContractAddressFormat(contractAddress)) {
      return NextResponse.json({ error: "A valid contract address is required." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const store = getPublishStore();
    if (!store.updateContractAddress) {
      return storageUnavailableResponse();
    }

    const result = await store.updateContractAddress({ slug, contractAddress });
    if (result.status === "site_not_found") {
      return NextResponse.json({ error: "No published site was found for that slug." }, { status: 404, headers: NO_STORE_HEADERS });
    }

    await recordAdminActivityBestEffort({
      kind: "site-contract-address-attached",
      message: `/${slug} contract address attached by admin: ${contractAddress}`,
    });

    return NextResponse.json({ site: result.site }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof PublishStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error(
      "Admin contract-address attach failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json(
      { error: "The contract address could not be attached. Try again." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

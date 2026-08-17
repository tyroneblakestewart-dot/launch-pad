import { NextResponse } from "next/server";
import { isAdminRequestOriginAllowed } from "@/lib/server/api-protection";
import {
  hashAdminSessionToken,
  parseAdminSessionCookie,
} from "@/lib/server/admin-auth";
import {
  AdminSessionStoreUnavailableError,
  isAdminSessionValid,
} from "@/lib/server/admin-session-store";
import { toFixedOperatingCost } from "@/lib/server/admin-operations-costs";
import {
  FixedOperatingCostsStoreUnavailableError,
  getFixedOperatingCostsStore,
  type CreateFixedOperatingCostInput,
  type FixedOperatingCostCadence,
} from "@/lib/server/fixed-operating-costs-store";

export const runtime = "nodejs";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const MAX_NAME_LENGTH = 120;
const MAX_NOTE_LENGTH = 500;
const MAX_AMOUNT_USD = 1_000_000;

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(token && (await isAdminSessionValid(hashAdminSessionToken(token))));
}

function storageUnavailableResponse() {
  return NextResponse.json(
    { error: "Fixed operating cost storage is not ready. Apply the latest database migrations and try again." },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

function errorResponse(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

type ParsedFixedCostBody = CreateFixedOperatingCostInput & { id?: string };

function parseFixedCostBody(body: unknown): { ok: true; value: ParsedFixedCostBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request body." };
  const candidate = body as Record<string, unknown>;

  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : undefined;

  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Enter a name between 1 and ${MAX_NAME_LENGTH} characters.` };
  }

  const amountUsd = typeof candidate.amountUsd === "number" ? candidate.amountUsd : Number.NaN;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > MAX_AMOUNT_USD) {
    return { ok: false, error: `Enter a positive dollar amount up to $${MAX_AMOUNT_USD.toLocaleString()}.` };
  }

  const cadence = candidate.cadence === "annual" || candidate.cadence === "monthly" ? (candidate.cadence as FixedOperatingCostCadence) : null;
  if (!cadence) {
    return { ok: false, error: "Cadence must be 'monthly' or 'annual'." };
  }

  const rawNote = typeof candidate.note === "string" ? candidate.note.trim() : "";
  if (rawNote.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `Keep the note under ${MAX_NOTE_LENGTH} characters.` };
  }
  const note = rawNote || null;

  return { ok: true, value: { id, name, amountUsd, cadence, note } };
}

export async function POST(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return errorResponse("Admin operations origin is not allowed.", 403);
    }
    if (!(await isAuthenticated(request))) {
      return errorResponse("Admin sign-in is required.", 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid request body.", 400);
    }

    const parsed = parseFixedCostBody(body);
    if (!parsed.ok) return errorResponse(parsed.error, 400);

    const created = await getFixedOperatingCostsStore().create({
      name: parsed.value.name,
      amountUsd: parsed.value.amountUsd,
      cadence: parsed.value.cadence,
      note: parsed.value.note,
    });
    return NextResponse.json({ fixedCost: toFixedOperatingCost(created) }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof FixedOperatingCostsStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error("Fixed operating cost creation failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return errorResponse("The fixed cost could not be added. Try again.");
  }
}

export async function PATCH(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return errorResponse("Admin operations origin is not allowed.", 403);
    }
    if (!(await isAuthenticated(request))) {
      return errorResponse("Admin sign-in is required.", 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid request body.", 400);
    }

    const parsed = parseFixedCostBody(body);
    if (!parsed.ok) return errorResponse(parsed.error, 400);
    if (!parsed.value.id) return errorResponse("A fixed cost id is required.", 400);

    const updated = await getFixedOperatingCostsStore().update({
      id: parsed.value.id,
      name: parsed.value.name,
      amountUsd: parsed.value.amountUsd,
      cadence: parsed.value.cadence,
      note: parsed.value.note,
    });
    if (!updated) return errorResponse("That fixed cost could not be found.", 404);
    return NextResponse.json({ fixedCost: toFixedOperatingCost(updated) }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof FixedOperatingCostsStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error("Fixed operating cost update failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return errorResponse("The fixed cost could not be updated. Try again.");
  }
}

export async function DELETE(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return errorResponse("Admin operations origin is not allowed.", 403);
    }
    if (!(await isAuthenticated(request))) {
      return errorResponse("Admin sign-in is required.", 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid request body.", 400);
    }
    const id = body && typeof body === "object" ? (body as Record<string, unknown>).id : undefined;
    if (typeof id !== "string" || !id.trim()) {
      return errorResponse("A fixed cost id is required.", 400);
    }

    const removed = await getFixedOperatingCostsStore().remove(id.trim());
    if (!removed) return errorResponse("That fixed cost could not be found.", 404);
    return NextResponse.json({ removed: true }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof FixedOperatingCostsStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error("Fixed operating cost deletion failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return errorResponse("The fixed cost could not be deleted. Try again.");
  }
}

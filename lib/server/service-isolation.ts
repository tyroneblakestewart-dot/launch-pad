import { NextResponse } from "next/server";
import type { AdminServiceControl, AdminServiceKey } from "@/lib/admin-operations";
import { getAdminOperationsStore } from "@/lib/server/admin-operations-store";

/**
 * Reads the durable circuit-breaker state. A control-store failure deliberately
 * fails open: a Postgres/control-table problem must not take unrelated public
 * services down. The admin dashboard will still surface the control-store error.
 */
export async function getIsolatedService(
  key: AdminServiceKey,
): Promise<AdminServiceControl | null> {
  try {
    const control = await getAdminOperationsStore().getServiceControl(key);
    return control.isolated ? control : null;
  } catch (error) {
    console.error(
      `Service isolation state could not be read for ${key}; allowing the request.`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/** Returns a standard 503 response only when the selected feature is isolated. */
export async function getServiceIsolationResponse(
  key: AdminServiceKey,
): Promise<NextResponse | null> {
  const control = await getIsolatedService(key);
  if (!control) return null;

  return NextResponse.json(
    {
      error: `${control.label} is temporarily paused for maintenance. Other Hoodlums services remain available.`,
      code: "SERVICE_ISOLATED",
      service: control.key,
    },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "60",
      },
    },
  );
}

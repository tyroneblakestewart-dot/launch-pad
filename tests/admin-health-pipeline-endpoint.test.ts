import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getPipeline } from "@/app/api/admin/health/pipeline/route";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionState,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-health-pipeline-test-session-token";
let cookie = "";

function getRequest(path: string, authenticated = true): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "GET",
    headers: authenticated ? { Cookie: cookie } : {},
  });
}

beforeEach(async () => {
  setAdminSessionStoreForTests(createMemoryAdminSessionStore(createMemoryAdminSessionState()));
  await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
  cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
});

afterEach(() => {
  resetAdminStoresForTests();
});

describe("GET /api/admin/health/pipeline", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await getPipeline(
      getRequest("/api/admin/health/pipeline?service=database", false),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a missing or unknown service", async () => {
    const missing = await getPipeline(getRequest("/api/admin/health/pipeline"));
    expect(missing.status).toBe(400);

    const unknown = await getPipeline(getRequest("/api/admin/health/pipeline?service=nonsense"));
    expect(unknown.status).toBe(400);
  });

  it("returns the requested service's pipeline, read-only, with no isolation control fields", async () => {
    const response = await getPipeline(
      getRequest("/api/admin/health/pipeline?service=deployment"),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      pipeline: { id: string; label: string; stages: Array<{ id: string; status: string }> };
      checkedAt: string;
    };
    expect(payload.pipeline.id).toBe("deployment");
    expect(payload.pipeline.stages.length).toBeGreaterThan(0);
    expect(payload.pipeline).not.toHaveProperty("isolated");
    expect(typeof payload.checkedAt).toBe("string");
  });

  it("returns a distinct pipeline per service", async () => {
    const database = await getPipeline(getRequest("/api/admin/health/pipeline?service=database"));
    const contracts = await getPipeline(getRequest("/api/admin/health/pipeline?service=contracts"));
    const databasePayload = (await database.json()) as { pipeline: { id: string } };
    const contractsPayload = (await contracts.json()) as { pipeline: { id: string } };
    expect(databasePayload.pipeline.id).toBe("database");
    expect(contractsPayload.pipeline.id).toBe("contracts");
  });
});

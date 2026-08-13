import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as runOutreachCronRoute } from "@/app/api/cron/outreach/route";
import {
  createMemoryAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import { resetOutreachStoreForTests, setOutreachStoreForTests } from "@/lib/server/outreach-store";
import { createMemoryOutreachStore } from "./outreach-test-helpers";

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_QUEUE_FLAG = process.env.OUTREACH_QUEUE_ENABLED;

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/cron/outreach", { headers });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.OUTREACH_QUEUE_ENABLED;
  setAdminOperationsStoreForTests(createMemoryAdminOperationsStore());
  setOutreachStoreForTests(createMemoryOutreachStore());
});

afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  if (ORIGINAL_QUEUE_FLAG === undefined) delete process.env.OUTREACH_QUEUE_ENABLED;
  else process.env.OUTREACH_QUEUE_ENABLED = ORIGINAL_QUEUE_FLAG;
  resetAdminOperationsStoreForTests();
  resetOutreachStoreForTests();
});

describe("GET /api/cron/outreach", () => {
  it("rejects a request with no bearer token", async () => {
    const response = await runOutreachCronRoute(request());
    expect(response.status).toBe(401);
  });

  it("rejects a request with the wrong bearer token", async () => {
    const response = await runOutreachCronRoute(request({ authorization: "Bearer wrong-secret" }));
    expect(response.status).toBe(401);
  });

  it("rejects every request when CRON_SECRET is unset — fails closed", async () => {
    delete process.env.CRON_SECRET;
    const response = await runOutreachCronRoute(request({ authorization: "Bearer test-cron-secret" }));
    expect(response.status).toBe(401);
  });

  it("returns a true no-op result when OUTREACH_QUEUE_ENABLED is unset", async () => {
    const response = await runOutreachCronRoute(request({ authorization: "Bearer test-cron-secret" }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; enabled: boolean };
    expect(payload.ok).toBe(true);
    expect(payload.enabled).toBe(false);
  });

  it("returns a 503 when the outreach service is administratively isolated, without running the cron", async () => {
    const operationsStore = createMemoryAdminOperationsStore();
    setAdminOperationsStoreForTests(operationsStore);
    await operationsStore.setServiceIsolation({ key: "outreach", isolated: true, reason: "maintenance" });

    const response = await runOutreachCronRoute(request({ authorization: "Bearer test-cron-secret" }));
    expect(response.status).toBe(503);
    const payload = (await response.json()) as { code: string };
    expect(payload.code).toBe("SERVICE_ISOLATED");
  });
});

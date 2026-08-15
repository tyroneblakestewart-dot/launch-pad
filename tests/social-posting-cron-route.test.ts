import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as runSocialPostingCronRoute } from "@/app/api/cron/social-posting/route";
import {
  createMemoryAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import { resetSocialConnectionsStoreForTests, setSocialConnectionsStoreForTests } from "@/lib/server/social-connections-store";
import { resetSocialScheduledPostsStoreForTests, setSocialScheduledPostsStoreForTests } from "@/lib/server/social-scheduled-posts-store";
import { createMemorySocialConnectionsStore } from "./social-connections-test-helpers";
import { createMemorySocialScheduledPostsStore } from "./social-scheduled-posts-test-helpers";

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/cron/social-posting", { headers });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
  setAdminOperationsStoreForTests(createMemoryAdminOperationsStore());
  setSocialConnectionsStoreForTests(createMemorySocialConnectionsStore());
  setSocialScheduledPostsStoreForTests(createMemorySocialScheduledPostsStore());
});

afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  resetAdminOperationsStoreForTests();
  resetSocialConnectionsStoreForTests();
  resetSocialScheduledPostsStoreForTests();
});

describe("GET /api/cron/social-posting", () => {
  it("rejects a request with no bearer token", async () => {
    const response = await runSocialPostingCronRoute(request());
    expect(response.status).toBe(401);
  });

  it("rejects a request with the wrong bearer token", async () => {
    const response = await runSocialPostingCronRoute(request({ authorization: "Bearer wrong-secret" }));
    expect(response.status).toBe(401);
  });

  it("rejects every request when CRON_SECRET is unset — fails closed", async () => {
    delete process.env.CRON_SECRET;
    const response = await runSocialPostingCronRoute(request({ authorization: "Bearer test-cron-secret" }));
    expect(response.status).toBe(401);
  });

  it("returns a true no-op result with the right bearer token and nothing due", async () => {
    const response = await runSocialPostingCronRoute(request({ authorization: "Bearer test-cron-secret" }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; processed: number };
    expect(payload).toMatchObject({ ok: true, processed: 0 });
  });

  it("returns a 503 when the social-posting service is administratively isolated, without running the cron", async () => {
    const operationsStore = createMemoryAdminOperationsStore();
    setAdminOperationsStoreForTests(operationsStore);
    await operationsStore.setServiceIsolation({ key: "social-posting", isolated: true, reason: "maintenance" });

    const response = await runSocialPostingCronRoute(request({ authorization: "Bearer test-cron-secret" }));
    expect(response.status).toBe(503);
    const payload = (await response.json()) as { code: string };
    expect(payload.code).toBe("SERVICE_ISOLATED");
  });
});

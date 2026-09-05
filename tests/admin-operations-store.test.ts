import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryAdminOperationsState,
  createMemoryAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import {
  getIsolatedService,
  getServiceIsolationResponse,
} from "@/lib/server/service-isolation";

let state: ReturnType<typeof createMemoryAdminOperationsState>;

beforeEach(() => {
  state = createMemoryAdminOperationsState();
  setAdminOperationsStoreForTests(createMemoryAdminOperationsStore(state));
});

afterEach(() => {
  resetAdminOperationsStoreForTests();
});

describe("admin service isolation store", () => {
  it("starts with every supported service active", async () => {
    const store = createMemoryAdminOperationsStore(state);
    const controls = await store.listServiceControls();
    expect(controls).toHaveLength(13);
    expect(controls.every((control) => control.isolated === false)).toBe(true);
  });

  it("persists isolation across separate serverless-style store instances", async () => {
    const writer = createMemoryAdminOperationsStore(state);
    const reader = createMemoryAdminOperationsStore(state);

    await writer.setServiceIsolation({
      key: "website-generation",
      isolated: true,
      reason: "Upstream AI provider is returning repeated failures.",
      now: new Date("2026-08-02T03:00:00.000Z"),
    });

    const control = await reader.getServiceControl("website-generation");
    expect(control.isolated).toBe(true);
    expect(control.reason).toContain("Upstream AI provider");

    const activity = await reader.listActivity(10);
    expect(activity[0]).toMatchObject({
      kind: "service-isolated",
      serviceKey: "website-generation",
    });
  });

  it("returns a controlled 503 only for the isolated service", async () => {
    const store = createMemoryAdminOperationsStore(state);
    await store.setServiceIsolation({
      key: "market-feed",
      isolated: true,
      reason: "Provider output is malformed while we investigate.",
    });

    const isolated = await getIsolatedService("market-feed");
    expect(isolated?.isolated).toBe(true);

    const response = await getServiceIsolationResponse("market-feed");
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      code: "SERVICE_ISOLATED",
      service: "market-feed",
    });

    expect(await getServiceIsolationResponse("website-generation")).toBeNull();
    expect(await getServiceIsolationResponse("public-publishing")).toBeNull();
    expect(await getServiceIsolationResponse("telegram-publishing")).toBeNull();
  });

  it("restores traffic and records the restoration", async () => {
    const store = createMemoryAdminOperationsStore(state);
    await store.setServiceIsolation({
      key: "telegram-publishing",
      isolated: true,
      reason: "Telegram API is unstable.",
    });
    await store.setServiceIsolation({
      key: "telegram-publishing",
      isolated: false,
      reason: "Telegram API recovered and was verified.",
    });

    expect(await getServiceIsolationResponse("telegram-publishing")).toBeNull();
    const activity = await store.listActivity(10);
    expect(activity[0]).toMatchObject({
      kind: "service-restored",
      serviceKey: "telegram-publishing",
    });
  });
});

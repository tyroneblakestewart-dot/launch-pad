import { describe, expect, it } from "vitest";
import { createMemoryFixedOperatingCostsStore } from "@/lib/server/fixed-operating-costs-store";

describe("createMemoryFixedOperatingCostsStore", () => {
  it("creates, lists, updates and removes a fixed cost", async () => {
    const store = createMemoryFixedOperatingCostsStore();
    const now = new Date("2026-01-01T00:00:00.000Z");

    const created = await store.create({ name: "Vercel hosting", amountUsd: 20, cadence: "monthly", note: null }, now);
    expect(created).toMatchObject({ name: "Vercel hosting", amountUsd: 20, cadence: "monthly" });

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);

    const updated = await store.update(
      { id: created.id, name: "Vercel hosting (Pro)", amountUsd: 25, cadence: "monthly", note: "upgraded" },
      new Date("2026-01-02T00:00:00.000Z"),
    );
    expect(updated).toMatchObject({ name: "Vercel hosting (Pro)", amountUsd: 25, note: "upgraded" });
    expect(updated?.createdAt).toBe(now.toISOString());
    expect(updated?.updatedAt).toBe("2026-01-02T00:00:00.000Z");

    const removed = await store.remove(created.id);
    expect(removed).toBe(true);
    expect(await store.list()).toHaveLength(0);
  });

  it("returns null from update and false from remove for an unknown id", async () => {
    const store = createMemoryFixedOperatingCostsStore();
    expect(await store.update({ id: "missing", name: "x", amountUsd: 1, cadence: "monthly", note: null })).toBeNull();
    expect(await store.remove("missing")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  removeSeededHoodlumsLaunch,
  SEEDED_HOODLUMS_LAUNCH_ID,
} from "@/lib/hoodlums-seed-cleanup";
import type { TokenProject } from "@/lib/types";

function makeProject(overrides: Partial<TokenProject> = {}): TokenProject {
  return {
    id: "user-project-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "draft",
    chain: "robinhood",
    name: "My Token",
    ticker: "MTK",
    description: "A token a real user made.",
    supply: "1000000",
    decimals: 18,
    websiteSlug: "my-token",
    contractAddress: "",
    xHandle: "",
    telegram: "",
    heroImage: "",
    theme: "hoodlums",
    ...overrides,
  };
}

describe("removeSeededHoodlumsLaunch", () => {
  it("removes only the record matching the fixed seeded id", () => {
    const seeded = makeProject({
      id: SEEDED_HOODLUMS_LAUNCH_ID,
      name: "Hoodlums",
      ticker: "HOODLUMS",
      status: "launched",
    });
    const mine = makeProject({ id: "user-project-1" });

    const cleaned = removeSeededHoodlumsLaunch([seeded, mine]);

    expect(cleaned).toEqual([mine]);
  });

  it("leaves a user's own saved projects untouched when no seeded record is present", () => {
    const mine = makeProject({ id: "user-project-1" });
    const another = makeProject({ id: "user-project-2", name: "Second one" });

    const cleaned = removeSeededHoodlumsLaunch([mine, another]);

    expect(cleaned).toEqual([mine, another]);
  });

  it("returns an empty array for an empty (fresh) project list", () => {
    expect(removeSeededHoodlumsLaunch([])).toEqual([]);
  });

  it("does not match a user project just because it shares the same contract address", () => {
    const lookalike = makeProject({
      id: "user-project-1",
      contractAddress: "0x3bf7447cd055f1475a8b09090c7b062abc9d3798",
    });

    expect(removeSeededHoodlumsLaunch([lookalike])).toEqual([lookalike]);
  });
});

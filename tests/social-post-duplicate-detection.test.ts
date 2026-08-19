import { describe, expect, it } from "vitest";
import {
  DUPLICATE_APPROVAL_WINDOW_MS,
  findDuplicateScheduledPost,
  type ExistingPostForDuplicateCheck,
} from "@/lib/server/social-post-duplicate-detection";

function post(overrides: Partial<ExistingPostForDuplicateCheck> = {}): ExistingPostForDuplicateCheck {
  return {
    id: "post-1",
    status: "scheduled",
    body: "gm hoodlums",
    createdAt: "2026-08-18T09:32:00.000Z",
    destinations: [{ platform: "telegram" }],
    ...overrides,
  };
}

const NOW = new Date("2026-08-18T09:33:00.000Z").getTime();

describe("findDuplicateScheduledPost (issue #380)", () => {
  it("matches a still-scheduled post with the same body and destinations created just before", () => {
    const found = findDuplicateScheduledPost([post()], { body: "gm hoodlums", destinations: ["telegram"] }, NOW);
    expect(found?.id).toBe("post-1");
  });

  it("ignores a post with different body text", () => {
    const found = findDuplicateScheduledPost([post({ body: "gm fam" })], { body: "gm hoodlums", destinations: ["telegram"] }, NOW);
    expect(found).toBeNull();
  });

  it("ignores a post to a different destination set, even with identical body (X and Telegram approve independently)", () => {
    const found = findDuplicateScheduledPost(
      [post({ destinations: [{ platform: "x" }] })],
      { body: "gm hoodlums", destinations: ["telegram"] },
      NOW,
    );
    expect(found).toBeNull();
  });

  it("matches regardless of destination array order", () => {
    const found = findDuplicateScheduledPost(
      [post({ destinations: [{ platform: "telegram" }, { platform: "x" }] })],
      { body: "gm hoodlums", destinations: ["x", "telegram"] },
      NOW,
    );
    expect(found?.id).toBe("post-1");
  });

  it("ignores posts that already sent, failed or were canceled — a resend is a deliberate new action", () => {
    for (const status of ["sent", "partially_sent", "failed", "canceled", "needs_composer"]) {
      expect(findDuplicateScheduledPost([post({ status })], { body: "gm hoodlums", destinations: ["telegram"] }, NOW)).toBeNull();
    }
  });

  it("ignores a match outside the duplicate window", () => {
    const oldEnough = NOW - DUPLICATE_APPROVAL_WINDOW_MS - 1000;
    const found = findDuplicateScheduledPost(
      [post({ createdAt: new Date(oldEnough).toISOString() })],
      { body: "gm hoodlums", destinations: ["telegram"] },
      NOW,
    );
    expect(found).toBeNull();
  });

  it("ignores a post created in the future relative to now (clock skew guard)", () => {
    const found = findDuplicateScheduledPost(
      [post({ createdAt: new Date(NOW + 60_000).toISOString() })],
      { body: "gm hoodlums", destinations: ["telegram"] },
      NOW,
    );
    expect(found).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(findDuplicateScheduledPost([], { body: "gm hoodlums", destinations: ["telegram"] }, NOW)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { buildErrorGroupDetailsText } from "@/lib/client-error-details-text";

describe("buildErrorGroupDetailsText (issue #405)", () => {
  const BASE_GROUP = {
    message: "Script error.",
    routePath: "/support",
    occurrenceCount: 4,
    firstSeen: "2026-08-21T18:44:00.000Z",
    lastSeen: "2026-08-22T05:09:00.000Z",
    representativeStack: null as string | null,
    buildId: "abc1234def",
  };

  it("includes message, route, build, first/last seen and occurrence count", () => {
    const text = buildErrorGroupDetailsText(BASE_GROUP);
    expect(text).toContain("Message: Script error.");
    expect(text).toContain("Route: /support");
    expect(text).toContain("Build: abc1234def");
    expect(text).toContain("First seen: 2026-08-21T18:44:00.000Z");
    expect(text).toContain("Last seen: 2026-08-22T05:09:00.000Z");
    expect(text).toContain("Occurrences: 4");
  });

  it("omits the Stack line entirely when there is no representative stack", () => {
    const text = buildErrorGroupDetailsText(BASE_GROUP);
    expect(text).not.toContain("Stack:");
  });

  it("includes the stack verbatim when present", () => {
    const text = buildErrorGroupDetailsText({ ...BASE_GROUP, representativeStack: "at foo (bar.js:1:1)" });
    expect(text).toContain("Stack:\nat foo (bar.js:1:1)");
  });

  it("labels a missing build id as unknown rather than the literal string 'null'", () => {
    const text = buildErrorGroupDetailsText({ ...BASE_GROUP, buildId: null });
    expect(text).toContain("Build: unknown");
    expect(text).not.toContain("null");
  });
});

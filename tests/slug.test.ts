import { describe, expect, it } from "vitest";
import {
  MAX_SLUG_LENGTH,
  RESERVED_SLUGS,
  findSlugCollision,
  slugify,
  validateSlug,
} from "@/lib/slug";

describe("slugify", () => {
  it("lowercases, hyphenates and trims free text", () => {
    expect(slugify("  Hoodlums  Token! ")).toBe("hoodlums-token");
    expect(slugify("HOOD-LUMS")).toBe("hood-lums");
    expect(slugify("")).toBe("");
  });

  it("caps the result at the max slug length without a trailing hyphen", () => {
    const longName = `${"a".repeat(MAX_SLUG_LENGTH)} extra words`;
    const result = slugify(longName);
    expect(result.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(result.endsWith("-")).toBe(false);
  });
});

describe("validateSlug", () => {
  it("accepts valid lowercase, hyphenated slugs", () => {
    expect(validateSlug("hoodlums")).toEqual({ valid: true });
    expect(validateSlug("hoodlums-2")).toEqual({ valid: true });
    expect(validateSlug("a".repeat(MAX_SLUG_LENGTH))).toEqual({ valid: true });
  });

  it("rejects an empty slug", () => {
    expect(validateSlug("").valid).toBe(false);
  });

  it("rejects uppercase letters and disallowed characters", () => {
    expect(validateSlug("Hoodlums").valid).toBe(false);
    expect(validateSlug("hood_lums").valid).toBe(false);
    expect(validateSlug("hood lums").valid).toBe(false);
    expect(validateSlug("hood.lums").valid).toBe(false);
  });

  it("rejects a slug longer than the max length", () => {
    const result = validateSlug("a".repeat(MAX_SLUG_LENGTH + 1));
    expect(result.valid).toBe(false);
  });

  it("rejects a leading or trailing hyphen", () => {
    expect(validateSlug("-hoodlums").valid).toBe(false);
    expect(validateSlug("hoodlums-").valid).toBe(false);
  });

  it("rejects repeated hyphens", () => {
    expect(validateSlug("hood--lums").valid).toBe(false);
  });

  it("rejects every reserved word exactly", () => {
    for (const reserved of RESERVED_SLUGS) {
      expect(validateSlug(reserved).valid).toBe(false);
    }
  });

  it("does not reject a slug that merely contains a reserved word as a substring", () => {
    expect(validateSlug("my-api-token").valid).toBe(true);
    expect(validateSlug("adminx").valid).toBe(true);
  });
});

describe("findSlugCollision", () => {
  const records = [
    { id: "a", websiteSlug: "hoodlums" },
    { id: "b", websiteSlug: "other-token" },
  ];

  it("finds a record using the same slug from a different id", () => {
    expect(findSlugCollision(records, "hoodlums", "b")?.id).toBe("a");
  });

  it("excludes the record currently being edited", () => {
    expect(findSlugCollision(records, "hoodlums", "a")).toBeNull();
  });

  it("returns null when no other record uses the slug", () => {
    expect(findSlugCollision(records, "unused-slug", "a")).toBeNull();
  });
});

/**
 * Shared slug rules used by both the studio save flow and the public
 * `app/[slug]` route, so a slug that is rejected at save time can never
 * differ from what the public route considers valid.
 */

export const MAX_SLUG_LENGTH = 48;

/**
 * Exact reserved words that would otherwise collide with an existing
 * top-level route (or a likely future one).
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "api",
  "account",
  "testnet",
  "providers",
  "allocations",
  "liquidity-lab",
  "monad",
  "social",
  "bonding-curve",
  "admin",
  "www",
]);

const ALLOWED_CHARACTERS_PATTERN = /^[a-z0-9-]+$/;

export type SlugValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Validates a slug that has already been produced by `slugify` (or typed
 * directly into the website-path field). Rules: lowercase ASCII letters,
 * digits and single hyphens only; no leading/trailing hyphen; no repeated
 * hyphens; at most `MAX_SLUG_LENGTH` characters; not a reserved word.
 */
export function validateSlug(slug: string): SlugValidationResult {
  if (!slug) {
    return { valid: false, reason: "Enter a website path." };
  }
  if (!ALLOWED_CHARACTERS_PATTERN.test(slug)) {
    return {
      valid: false,
      reason: "Website path can only contain lowercase letters, numbers and hyphens.",
    };
  }
  if (slug.length > MAX_SLUG_LENGTH) {
    return {
      valid: false,
      reason: `Website path must be ${MAX_SLUG_LENGTH} characters or fewer.`,
    };
  }
  if (slug.startsWith("-") || slug.endsWith("-")) {
    return { valid: false, reason: "Website path cannot start or end with a hyphen." };
  }
  if (slug.includes("--")) {
    return { valid: false, reason: "Website path cannot contain repeated hyphens." };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return {
      valid: false,
      reason: `"${slug}" is a reserved path and cannot be used as a website path.`,
    };
  }
  return { valid: true };
}

/**
 * Best-effort conversion of free text (usually the token name) into a
 * candidate slug. The result still needs `validateSlug` before it is safe
 * to save or publish — this only normalises characters/length.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/, "");
}

/**
 * Finds another record (excluding `excludeId`) that already uses `slug`.
 * This is a local, browser-storage-only guard — it cannot see other
 * browsers or devices, so it is not an authoritative uniqueness check.
 * The future publish endpoint must still enforce an atomic server-side
 * unique-slug constraint.
 */
export function findSlugCollision<T extends { id: string; websiteSlug: string }>(
  records: readonly T[],
  slug: string,
  excludeId: string,
): T | null {
  return records.find((item) => item.websiteSlug === slug && item.id !== excludeId) || null;
}

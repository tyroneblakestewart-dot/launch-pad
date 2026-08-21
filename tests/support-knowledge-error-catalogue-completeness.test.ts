import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CATALOGUE, matchErrorCatalogueEntries } from "@/lib/server/support-knowledge/error-catalogue";

// The completeness mechanism for issue #400's error catalogue, mirroring
// tests/backend-inventory.test.ts's walk-the-filesystem pattern. This test
// FAILS the suite whenever a new user-facing `error: "..."` string ships in
// a non-admin, non-cron API route without a matching catalogue entry — that
// failure is the thing that forces the knowledge base to stay current as
// the app evolves, per the issue's own requirement. It also fails the other
// direction: a catalogue entry whose exact string / pattern no longer
// matches anything in source (a rename that orphaned the entry).
//
// Scope: admin/cron routes are deliberately excluded — they're owner/system
// surfaces a ticket-filing wallet never sees, so cataloguing them wouldn't
// help diagnose a user's ticket. See lib/server/support-knowledge/error-catalogue.ts's
// header comment for the full reasoning.

const ROOT = process.cwd();
const ERROR_STRING_PATTERN = /error:\s*"([^"]{3,})"/g;

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(absolute);
      return [absolute];
    }),
  );
  return files.flat();
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/** Every distinct literal `error: "..."` string extracted from `source`. Exported shape mirrored inline (not from a shared lib module) to match backend-inventory.test.ts's own self-contained convention. */
export function extractErrorStrings(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(ERROR_STRING_PATTERN)) {
    found.add(match[1]);
  }
  return [...found];
}

// Server-to-server webhook: Telegram calls this, never a ticket-filing
// wallet, so its error strings can't help diagnose a user's ticket either.
const NON_USER_FACING_ROUTES = new Set(["app/api/telegram/subscription-webhook/route.ts"]);

async function userFacingRouteFiles(): Promise<string[]> {
  const routeFiles = (await walk(path.join(ROOT, "app", "api"))).filter((file) => file.endsWith(`${path.sep}route.ts`)).map(relative);
  return routeFiles
    .filter((file) => !file.startsWith("app/api/admin/"))
    .filter((file) => !file.startsWith("app/api/cron/"))
    .filter((file) => !NON_USER_FACING_ROUTES.has(file))
    .sort();
}

describe("support knowledge: error catalogue completeness (issue #400)", () => {
  it("covers every distinct user-facing error string with a catalogue entry", async () => {
    const files = await userFacingRouteFiles();
    expect(files.length).toBeGreaterThan(0);

    const uncatalogued: string[] = [];
    for (const file of files) {
      const source = await readFile(path.join(ROOT, file), "utf8");
      for (const message of extractErrorStrings(source)) {
        if (matchErrorCatalogueEntries(message).length === 0) {
          uncatalogued.push(`${file}: "${message}"`);
        }
      }
    }

    expect(uncatalogued, "Add a lib/server/support-knowledge/error-catalogue.ts entry (exact or pattern) for each of these before merging.").toEqual([]);
  });

  it("never lets a catalogue entry go orphaned by a source rename", async () => {
    const files = await userFacingRouteFiles();
    const allMessages = new Set<string>();
    for (const file of files) {
      const source = await readFile(path.join(ROOT, file), "utf8");
      extractErrorStrings(source).forEach((message) => allMessages.add(message));
    }

    const orphaned = ERROR_CATALOGUE.filter(
      (entry) => ![...allMessages].some((message) => matchErrorCatalogueEntries(message).some((matched) => matched.id === entry.id)),
    ).map((entry) => entry.id);

    expect(orphaned, "These catalogue entries no longer match any real source string — the code was renamed and the entry is now stale.").toEqual([]);
  });

  it("demonstrates the completeness mechanism: a new uncatalogued error string in a fixture is flagged as missing", () => {
    const fixtureSource = `
      export async function POST() {
        return NextResponse.json({ error: "This is a brand new fixture-only error message." }, { status: 400 });
      }
    `;
    const messages = extractErrorStrings(fixtureSource);
    expect(messages).toContain("This is a brand new fixture-only error message.");
    expect(matchErrorCatalogueEntries("This is a brand new fixture-only error message.")).toEqual([]);
  });

  it("demonstrates the completeness mechanism: an already-catalogued message from a fixture is matched", () => {
    const fixtureSource = `
      export async function POST() {
        return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
      }
    `;
    const messages = extractErrorStrings(fixtureSource);
    expect(messages).toContain("Invalid request body.");
    expect(matchErrorCatalogueEntries("Invalid request body.").length).toBeGreaterThan(0);
  });

  it("every catalogue entry has non-empty cause/fix/userReplyTemplate text", () => {
    for (const entry of ERROR_CATALOGUE) {
      expect(entry.cause.trim().length, `${entry.id}: cause`).toBeGreaterThan(0);
      expect(entry.fix.trim().length, `${entry.id}: fix`).toBeGreaterThan(0);
      expect(entry.userReplyTemplate.trim().length, `${entry.id}: userReplyTemplate`).toBeGreaterThan(0);
    }
  });

  it("has no duplicate entry ids", () => {
    const ids = ERROR_CATALOGUE.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

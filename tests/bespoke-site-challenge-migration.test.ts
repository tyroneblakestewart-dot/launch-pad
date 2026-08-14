import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]) {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("durable bespoke-site wallet challenges", () => {
  it("stores only bounded single-use authentication state", async () => {
    const migration = await source(
      "db",
      "migrations",
      "014_bespoke_site_challenges.sql",
    );
    const schema = migration.replace(/--.*$/gm, "");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS bespoke_site_challenges");
    expect(schema).toContain("nonce_hash CHAR(64) NOT NULL UNIQUE");
    expect(schema).toContain("wallet_address VARCHAR(42) NOT NULL");
    expect(schema).toContain("project_hash CHAR(66) NOT NULL");
    expect(schema).toContain("expires_at TIMESTAMPTZ NOT NULL");
    expect(schema).toContain("used_at TIMESTAMPTZ");
    expect(schema).toContain("CHECK (expires_at > issued_at)");
    expect(schema).not.toMatch(/\bsignature\b/i);
    expect(schema).not.toMatch(/\b(?:artwork|generated_html|prompt)\b/i);
  });

  it("atomically locks and consumes a challenge before signature verification", async () => {
    const store = await source(
      "lib",
      "server",
      "bespoke-site-challenge-store.ts",
    );
    const authoriser = await source(
      "lib",
      "server",
      "bespoke-site-entitlement.ts",
    );

    expect(store).toContain("FOR UPDATE");
    expect(store).toContain("SET used_at = $2");
    expect(store).toContain("COALESCE(used_at, expires_at) < $1");
    expect(authoriser.indexOf(".consume({")).toBeLessThan(
      authoriser.indexOf("options.verify ?? verifyMessage"),
    );
    expect(authoriser).toContain('consumed.status === "replayed"');
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("token launch artwork migration", () => {
  it("adds a nullable, size-bounded artwork_thumbnail column to token_launches", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "db/migrations/030_token_launch_artwork.sql"),
      "utf8",
    );

    expect(sql).toContain("ALTER TABLE token_launches");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS artwork_thumbnail TEXT");
    expect(sql).toMatch(/CHECK \(artwork_thumbnail IS NULL OR octet_length\(artwork_thumbnail\) <= \d+\)/);
    expect(sql).toContain("BEGIN;");
    expect(sql).toContain("COMMIT;");
  });
});

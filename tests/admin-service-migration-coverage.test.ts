import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_SERVICE_DEFINITIONS } from "@/lib/admin-operations";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

function extractConstraintKeys(sql: string, constraintName: string): string[] | null {
  const constraintMatch = sql.match(
    new RegExp(`ADD CONSTRAINT ${constraintName} CHECK \\(([\\s\\S]*?)\\n\\s*\\);`),
  );
  if (!constraintMatch) return null;
  return Array.from(constraintMatch[1].matchAll(/'([a-z0-9-]+)'/g)).map((match) => match[1]);
}

async function latestKnownServiceKeys(constraintName: string): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  let latest: string[] | null = null;
  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const keys = extractConstraintKeys(sql, constraintName);
    if (keys) latest = keys;
  }

  if (!latest) throw new Error(`No migration defines constraint ${constraintName}`);
  return latest;
}

describe("admin service migration coverage", () => {
  it("widens admin_service_controls_known_service for every AdminServiceKey", async () => {
    const allowedKeys = await latestKnownServiceKeys("admin_service_controls_known_service");
    for (const definition of ADMIN_SERVICE_DEFINITIONS) {
      expect(allowedKeys, `service_key '${definition.key}' missing from the latest migration's admin_service_controls_known_service constraint`).toContain(
        definition.key,
      );
    }
  });

  it("widens admin_activity_log_known_service for every AdminServiceKey", async () => {
    const allowedKeys = await latestKnownServiceKeys("admin_activity_log_known_service");
    for (const definition of ADMIN_SERVICE_DEFINITIONS) {
      expect(allowedKeys, `service_key '${definition.key}' missing from the latest migration's admin_activity_log_known_service constraint`).toContain(
        definition.key,
      );
    }
  });
});

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required to apply database migrations.");
  process.exit(1);
}

const migrationsDirectory = path.join(process.cwd(), "db", "migrations");
const files = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

const migrationsByPrefix = new Map();
for (const file of files) {
  const match = /^(\d{3})_/.exec(file);
  if (!match) {
    throw new Error(`Migration file must start with a three-digit prefix: ${file}`);
  }
  const prefix = match[1];
  const existing = migrationsByPrefix.get(prefix);
  if (existing) {
    throw new Error(
      `Duplicate migration prefix ${prefix}: ${existing} and ${file}`,
    );
  }
  migrationsByPrefix.set(prefix, file);
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
  allowExitOnIdle: true,
});

try {
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    await pool.query(sql);
    console.log(`Applied ${file}`);
  }
} finally {
  await pool.end();
}

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required to apply database migrations.");
  process.exit(1);
}

const MIGRATION_HISTORY_TABLE = "hoodlums_schema_migrations";
const MIGRATION_COMPATIBILITY = new Map([
  [
    "011_plan_payments.sql",
    {
      legacyFilename: "008_plan_payments.sql",
      // The renamed migration must retain its original dependency position:
      // subscription lifecycle migration 010 alters the table it creates.
      order: 8.5,
      appliedProbe:
        "SELECT to_regclass('public.plan_payment_events') IS NOT NULL AS applied",
    },
  ],
]);

function migrationPrefix(file) {
  const match = /^(\d{3})_/.exec(file);
  if (!match) {
    throw new Error(`Migration file must start with a three-digit prefix: ${file}`);
  }
  return match[1];
}

function migrationOrder(file) {
  return MIGRATION_COMPATIBILITY.get(file)?.order ?? Number(migrationPrefix(file));
}

const migrationsDirectory = path.join(process.cwd(), "db", "migrations");
const files = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort((left, right) => {
    const orderDifference = migrationOrder(left) - migrationOrder(right);
    return orderDifference || left.localeCompare(right, "en", { numeric: true });
  });

const migrationsByPrefix = new Map();
for (const file of files) {
  const prefix = migrationPrefix(file);
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

async function recordMigration(filename, remappedFrom = null) {
  await pool.query(
    `INSERT INTO ${MIGRATION_HISTORY_TABLE} (filename, remapped_from)
     VALUES ($1, $2)
     ON CONFLICT (filename) DO NOTHING`,
    [filename, remappedFrom],
  );
}

async function recogniseCompatibleMigration(file, appliedMigrations) {
  const compatibility = MIGRATION_COMPATIBILITY.get(file);
  if (!compatibility) return false;

  if (appliedMigrations.has(compatibility.legacyFilename)) {
    await recordMigration(file, compatibility.legacyFilename);
    console.log(
      `Skipped ${file}; remapped from recorded ${compatibility.legacyFilename}`,
    );
    return true;
  }

  const probe = await pool.query(compatibility.appliedProbe);
  if (probe.rows[0]?.applied) {
    await recordMigration(file, compatibility.legacyFilename);
    console.log(
      `Skipped ${file}; existing schema matches applied ${compatibility.legacyFilename}`,
    );
    return true;
  }

  return false;
}

try {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${MIGRATION_HISTORY_TABLE} (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       remapped_from TEXT
     )`,
  );

  const history = await pool.query(
    `SELECT filename FROM ${MIGRATION_HISTORY_TABLE}`,
  );
  const appliedMigrations = new Set(history.rows.map((row) => row.filename));

  for (const file of files) {
    if (appliedMigrations.has(file)) {
      console.log(`Skipped ${file}; already applied`);
      continue;
    }

    if (await recogniseCompatibleMigration(file, appliedMigrations)) {
      appliedMigrations.add(file);
      continue;
    }

    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    await pool.query(sql);
    await recordMigration(file);
    appliedMigrations.add(file);
    console.log(`Applied ${file}`);
  }
} finally {
  await pool.end();
}

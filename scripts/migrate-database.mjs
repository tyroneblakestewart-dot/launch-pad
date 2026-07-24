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
  .sort();

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

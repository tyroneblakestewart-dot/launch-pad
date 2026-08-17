import { afterEach, describe, expect, it } from "vitest";
import {
  DATABASE_POOL_IDLE_TIMEOUT_MS,
  DEFAULT_DATABASE_POOL_MAX,
  getPostgresPool,
  readDatabasePoolMax,
  resetPostgresPoolsForTests,
} from "@/lib/server/postgres";

type InspectablePool = {
  options: {
    max: number;
    idleTimeoutMillis: number;
  };
};

function optionsFor(databaseUrl: string, value: string | undefined = undefined) {
  const env = value === undefined ? {} : { DATABASE_POOL_MAX: value };
  const pool = getPostgresPool(databaseUrl, env) as unknown as InspectablePool;
  return pool.options;
}

afterEach(() => {
  resetPostgresPoolsForTests();
  delete process.env.DATABASE_POOL_MAX;
});

describe("readDatabasePoolMax", () => {
  it("defaults to one when DATABASE_POOL_MAX is unset", () => {
    expect(readDatabasePoolMax({})).toBe(DEFAULT_DATABASE_POOL_MAX);
    expect(optionsFor("postgresql://user:pass@localhost:5432/default").max).toBe(1);
  });

  it("honours a valid positive integer", () => {
    expect(readDatabasePoolMax({ DATABASE_POOL_MAX: "3" })).toBe(3);
    expect(optionsFor("postgresql://user:pass@localhost:5432/valid", "3").max).toBe(3);
  });

  it.each(["", "   ", "garbage", "0", "-1", "1.5"])(
    "falls back to one without throwing for %j",
    (value) => {
      expect(() => readDatabasePoolMax({ DATABASE_POOL_MAX: value })).not.toThrow();
      expect(readDatabasePoolMax({ DATABASE_POOL_MAX: value })).toBe(1);
      expect(optionsFor(`postgresql://user:pass@localhost:5432/invalid-${encodeURIComponent(value)}`, value).max).toBe(1);
    },
  );
});

describe("getPostgresPool registry", () => {
  it("returns the same warm-instance pool for the same exact connection string", () => {
    const databaseUrl = "postgresql://user:pass@localhost:5432/same";
    const first = getPostgresPool(databaseUrl, { DATABASE_POOL_MAX: "1" });
    const second = getPostgresPool(databaseUrl, { DATABASE_POOL_MAX: "9" });
    const other = getPostgresPool("postgresql://user:pass@localhost:5432/other", {
      DATABASE_POOL_MAX: "1",
    });

    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it("uses the short transaction-pooler idle timeout", () => {
    expect(optionsFor("postgresql://user:pass@localhost:5432/idle").idleTimeoutMillis).toBe(
      DATABASE_POOL_IDLE_TIMEOUT_MS,
    );
    expect(DATABASE_POOL_IDLE_TIMEOUT_MS).toBe(5_000);
  });
});

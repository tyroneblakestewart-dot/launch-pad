import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Regression coverage for issue #386. The heartbeat pool is mocked in
// tests/social-posting-cron.test.ts, so no test in this repo actually
// executes this SQL against Postgres — a statement that is invalid at the
// database level can still ship green. This test instead makes a
// source-level assertion strong enough to have caught the original bug:
// Postgres deduces a parameter's type from the specific expression it
// appears in (e.g. inside `CASE WHEN $4 THEN $3 ELSE NULL END`), not from
// the column it's eventually assigned to. A parameter reused across
// multiple expressions in one statement must therefore carry an explicit
// `::type` cast at every occurrence, or Postgres can reject the whole
// statement with "inconsistent types deduced for parameter $N" — which is
// exactly what happened to markCompleted's reuse of $3 and $4.
//
// Real verification that the fix works is the production Vercel log line
// disappearing and /admin -> System Health's social-posting freshness
// stage turning green, not this test — this test only guards against the
// casts being "cleaned up" again later without anyone re-running that
// production check.
describe("social posting heartbeat SQL parameter typing (issue #386)", () => {
  it("casts every reused positional parameter at each occurrence", async () => {
    const source = await readFile(path.join(process.cwd(), "lib/server/social-posting-cron.ts"), "utf8");

    const sqlStatements = [...source.matchAll(/`(INSERT INTO scheduled_job_heartbeats[\s\S]*?)`/g)].map((match) => match[1]);
    // markStarted and markCompleted each issue exactly one heartbeat INSERT.
    expect(sqlStatements).toHaveLength(2);

    for (const sql of sqlStatements) {
      const totalOccurrences = new Map<string, number>();
      const castOccurrences = new Map<string, number>();

      for (const match of sql.matchAll(/\$(\d+)(::\w+)?/g)) {
        const param = `$${match[1]}`;
        totalOccurrences.set(param, (totalOccurrences.get(param) ?? 0) + 1);
        if (match[2]) {
          castOccurrences.set(param, (castOccurrences.get(param) ?? 0) + 1);
        }
      }

      for (const [param, count] of totalOccurrences) {
        if (count < 2) continue; // A parameter used only once has nothing to reconcile against.
        expect(
          castOccurrences.get(param) ?? 0,
          `${param} is reused ${count}x in this heartbeat statement but is not explicitly cast (::type) at every occurrence — this is the exact pattern that caused issue #386's "inconsistent types deduced for parameter" failure.`,
        ).toBe(count);
      }
    }
  });
});

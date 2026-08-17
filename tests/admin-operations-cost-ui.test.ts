import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("admin operations cost section (issue #368)", () => {
  it("shows a clearly labelled estimated operating costs disclaimer", async () => {
    const section = await source("components/admin-operations-cost-section.tsx");
    expect(section).toContain("Estimated operating costs.");
    expect(section).toContain("not the");
    expect(section).toContain("provider invoice");
    expect(section).toContain("Reconcile weekly during launch/active testing and at least monthly");
    expect(section).toContain("once stable.");
  });

  it("renders today/this-month/last-month period cards", async () => {
    const section = await source("components/admin-operations-cost-section.tsx");
    expect(section).toContain('title="Today so far"');
    expect(section).toContain('title="This month"');
    expect(section).toContain('title="Last month"');
  });

  it("includes a fixed-cost editor with add, edit and delete, and shows annual entries' monthly equivalent", async () => {
    const section = await source("components/admin-operations-cost-section.tsx");
    expect(section).toContain("Add fixed cost");
    expect(section).toContain("startEdit");
    expect(section).toContain("deleteFixedCost");
    expect(section).toContain("monthlyEquivalentUsd");
    expect(section).toContain("month equivalent");
  });

  it("states free-site/site-style spend is genuinely unattributed and shows it as its own reconciliation line", async () => {
    const section = await source("components/admin-operations-cost-section.tsx");
    expect(section).toContain("no wallet in their request contract");
    expect(section).toContain("Unattributed this month");
  });

  it("never claims the bounded top-wallet table covers all attributed spend", async () => {
    const section = await source("components/admin-operations-cost-section.tsx");
    expect(section).toContain("does not cover all attributed");
    expect(section).toContain("Attributed this month");
  });

  it("shows the live activity ledger with relative time", async () => {
    const section = await source("components/admin-operations-cost-section.tsx");
    expect(section).toContain("Live activity ledger");
    expect(section).toContain("relativeTime");
  });

  it("shows a Test access label for test-allowlist wallets with $0 verified revenue, without a fabricated payment row", async () => {
    const section = await source("components/admin-operations-cost-section.tsx");
    expect(section).toContain("Test access");
    expect(section).toContain('wallet.accessSource === "test-allowlist"');
  });

  it("reuses the dashboard's existing 30-second polling instead of adding a second loop", async () => {
    const section = await source("components/admin-operations-cost-section.tsx");
    expect(section).not.toContain("setInterval");
    expect(section).not.toContain("useEffect");
    const dashboard = await source("components/admin-dashboard.tsx");
    expect(dashboard).toContain("AdminOperationsCostSection");
    expect(dashboard).toContain('activeSection === "operations-cost"');
    expect(dashboard).toContain('label: "Operations"');
  });

  it("gives the Operations tab its own top-level entry, following the existing section pattern", async () => {
    const dashboard = await source("components/admin-dashboard.tsx");
    expect(dashboard).toContain('{ id: "operations-cost", label: "Operations" }');
  });

  it("never falls through to the zero-valued financial dashboard when cost data is unavailable (issue #368 correction pass)", async () => {
    const section = await source("components/admin-operations-cost-section.tsx");
    const unavailableCheckIndex = section.indexOf('costs.status === "unavailable"');
    expect(unavailableCheckIndex).toBeGreaterThan(-1);

    // The "available" branch of that ternary must be the one and only place
    // the monetary cards, reconciliation, ledger and fixed-cost editor are
    // rendered — never before the check, and never in the "unavailable" arm.
    const availableBranchStart = section.indexOf(") : (", unavailableCheckIndex);
    expect(availableBranchStart).toBeGreaterThan(unavailableCheckIndex);

    for (const marker of [
      "styles.periodGrid",
      "styles.reconciliationGrid",
      "Live activity ledger",
      "Add fixed cost",
    ]) {
      const firstIndex = section.indexOf(marker);
      expect(firstIndex, `expected "${marker}" to appear only after the unavailable check's available branch`).toBeGreaterThan(
        availableBranchStart,
      );
    }
  });
});

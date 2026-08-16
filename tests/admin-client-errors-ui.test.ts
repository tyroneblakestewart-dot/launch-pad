import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("admin Errors section UI", () => {
  it("is wired into the admin dashboard as its own section", async () => {
    const dashboard = await source("components/admin-dashboard.tsx");
    expect(dashboard).toContain("AdminClientErrorsSection");
    expect(dashboard).toContain('{ id: "client-errors", label: "Errors" }');
    expect(dashboard).toContain('activeSection === "client-errors"');
  });

  it("loads groups from the read-only admin endpoint and can resolve a group", async () => {
    const component = await source("components/admin-client-errors-section.tsx");
    expect(component).toContain('fetch("/api/admin/client-errors"');
    expect(component).toContain('fetch("/api/admin/client-errors/actions"');
    expect(component).toContain('window.location.replace("/admin")');
  });

  it("shows occurrence count, first/last seen, distinct wallets, build id and an expandable stack", async () => {
    const component = await source("components/admin-client-errors-section.tsx");
    expect(component).toContain("occurrenceCount");
    expect(component).toContain("firstSeen");
    expect(component).toContain("lastSeen");
    expect(component).toContain("distinctWallets");
    expect(component).toContain("buildId");
    expect(component).toContain("representativeStack");
    expect(component).toContain("Resolve");
  });
});

describe("global crash reporting wiring", () => {
  it("mounts the client error reporter around the app in the root layout", async () => {
    const layout = await source("app/layout.tsx");
    expect(layout).toContain("ClientErrorReporter");
  });

  it("registers window error and unhandledrejection handlers, and a React error boundary", async () => {
    const component = await source("components/client-error-reporter.tsx");
    expect(component).toContain('addEventListener("error"');
    expect(component).toContain('addEventListener("unhandledrejection"');
    expect(component).toContain("getDerivedStateFromError");
    expect(component).toContain("componentDidCatch");
  });
});

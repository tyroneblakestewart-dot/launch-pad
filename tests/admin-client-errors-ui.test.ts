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

  it("offers a per-group Copy details button using the clipboard helper with a safe fallback (issue #405)", async () => {
    const component = await source("components/admin-client-errors-section.tsx");
    expect(component).toContain('import { copyToClipboard } from "@/lib/clipboard";');
    expect(component).toContain("async function handleCopyDetails(group: ClientErrorGroup): Promise<void> {");
    expect(component).toContain("Copy details");
    expect(component).toContain('"Copied"');
    expect(component).toContain('"Copy failed"');

    const css = await source("components/admin-client-errors-section.module.css");
    expect(css).toContain(".copyDetailsButton");
    expect(css).toMatch(/\.expandButton, \.resolveButton, \.copyDetailsButton \{[^}]*min-height:\s*44px/);
  });

  it("builds the copied text from the pure lib/client-error-details-text.ts helper, not inline in the component", async () => {
    const component = await source("components/admin-client-errors-section.tsx");
    expect(component).toContain('import { buildErrorGroupDetailsText } from "@/lib/client-error-details-text";');
    expect(component).toContain("buildErrorGroupDetailsText(group)");
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

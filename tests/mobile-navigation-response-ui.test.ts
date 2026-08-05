import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("mobile bottom navigation responsiveness", () => {
  it("shows the touched destination as active before pathname navigation completes", async () => {
    const component = await source("components/app-navigation.tsx");

    expect(component).toContain("const [pendingTarget, setPendingTarget]");
    expect(component).toContain("pendingTarget?.href === item.href");
    expect(component).toContain("pendingTarget.fromPathname === pathname");
    expect(component).toContain("onPointerDown={(event) => {");
    expect(component).toContain('event.pointerType === "touch"');
    expect(component).toContain("markPending(item.href)");
    expect(component).toContain('aria-current={active ? "page" : undefined}');
  });

  it("fully prefetches bottom-navigation destinations in production", async () => {
    const component = await source("components/app-navigation.tsx");

    expect(component).toContain("prefetch={true}");
  });

  it("provides an immediate loading boundary while async routes render", async () => {
    const loading = await source("app/(app)/loading.tsx");

    expect(loading).toContain('aria-live="polite"');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("Loading Hoodlums…");
  });
});

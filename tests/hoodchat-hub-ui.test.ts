import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The application suite runs in Node without a browser DOM. These assertions
// protect the Safari-specific layout decision in source; the final tap feel
// still needs confirmation on a real iPhone Safari preview.

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("HoodChat category tabs", () => {
  it("keeps the category controls as native tabs with an immediate React state update", async () => {
    const component = await source("components/hoodchat-hub.tsx");

    expect(component).toContain('role="tablist"');
    expect(component).toContain('role="tab"');
    expect(component).toContain('aria-selected={filter === tab.id}');
    expect(component).toContain('onClick={() => setFilter(tab.id)}');
    expect(component).not.toContain("onTouchStart");
  });

  it("does not put the tabs in a horizontal momentum scroller on iPhone widths", async () => {
    const css = await source("components/hoodchat-hub.module.css");

    expect(css).not.toContain("overflow-x: auto");
    expect(css).not.toContain("-webkit-overflow-scrolling");
    expect(css).not.toContain(".filterTabs::-webkit-scrollbar");
  });

  it("lays the five mobile tabs out across exactly two grid rows", async () => {
    const css = await source("components/hoodchat-hub.module.css");

    expect(css).toContain("@media (max-width: 639px)");
    expect(css).toContain("grid-template-columns: repeat(6, minmax(0, 1fr));");
    expect(css).toContain("grid-column: span 2;");
    expect(css).toContain(".filterTab:nth-child(-n + 2)");
    expect(css).toContain("grid-column: span 3;");
  });
});

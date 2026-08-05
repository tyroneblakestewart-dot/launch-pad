import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The application suite runs in Node without a browser DOM. These assertions
// protect the Safari-specific event and layout decisions in source; the final
// tap feel still needs confirmation on a real iPhone Safari preview.

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("HoodChat category tabs", () => {
  it("keeps native tabs and activates touch input on pointerup instead of waiting for click", async () => {
    const component = await source("components/hoodchat-hub.tsx");

    expect(component).toContain('role="tablist"');
    expect(component).toContain('role="tab"');
    expect(component).toContain('aria-selected={filter === tab.id}');
    expect(component).toContain("onPointerUp={(event) => {");
    expect(component).toContain('event.pointerType === "touch"');
    expect(component).toContain("event.preventDefault();");
    expect(component).toContain("activateFilter(tab.id);");
    expect(component).toContain('onClick={() => activateFilter(tab.id)}');
    expect(component).not.toContain("onTouchStart");
  });

  it("paints the selected tab before reconciling the message feed", async () => {
    const component = await source("components/hoodchat-hub.tsx");

    expect(component).toContain("useDeferredValue");
    expect(component).toContain("const deferredFilter = useDeferredValue(filter);");
    expect(component).toContain("const activeMessages = messagesByFilter[deferredFilter];");
    expect(component).toContain("aria-busy={deferredFilter !== filter || activeMessages === undefined}");
  });

  it("loads one all-message feed and builds every category cache locally", async () => {
    const component = await source("components/hoodchat-hub.tsx");

    expect(component).toContain('fetch("/api/hoodchat/messages", { cache: "no-store" })');
    expect(component).toContain("function buildFilterMessageCache(messages: HoodchatMessage[])");
    expect(component).toContain("setMessagesByFilter(buildFilterMessageCache(loadedMessages));");
    expect(component).not.toContain("?category=${filter}");
    expect(component).not.toContain("Promise.all(FILTER_TABS.map");
  });

  it("never scrolls the whole iPhone viewport while changing category", async () => {
    const component = await source("components/hoodchat-hub.tsx");

    expect(component).toContain("feed.scrollTop = feed.scrollHeight;");
    expect(component).not.toContain("scrollIntoView");
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

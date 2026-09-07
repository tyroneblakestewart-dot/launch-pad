import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function source(...segments: string[]) {
  return readFile(path.join(process.cwd(), ...segments), "utf8");
}

/**
 * Setup tab declutter (owner direction, 7 Sep 2026): "remove this how you
 * sound … and saved post if edit or access make it hover box then collapses".
 * The saved example posts leave the inline list for a hover box (tap on
 * touch) that collapses again, and the Voice preview heading loses its
 * subtitle and the Tone/Vocabulary/Cadence/Emoji dump.
 */
describe("Setup tab: saved examples hover box and the trimmed Voice preview", () => {
  it("collapses the saved examples into a hover box that the trigger toggles and leaving closes", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("const [voiceExamplesOpen, setVoiceExamplesOpen] = useState(false);");
    // A mouse opens on hover and closes on leave; a touch pointer never does (a tap would leave a sticky
    // :hover behind on hybrid devices and the box could not collapse) — touch and keyboard toggle it.
    expect(hub).toContain("onPointerEnter={openVoiceExamplesFromPointer}");
    expect(hub).toContain("onPointerLeave={closeVoiceExamplesFromPointer}");
    expect(hub).toContain('if (event.pointerType !== "mouse") return;\n    cancelVoiceExamplesClose();\n    setVoiceExamplesOpen(true);');
    expect(hub).not.toContain("onMouseEnter={() => setVoiceExamplesOpen");
    expect(hub).not.toContain("onMouseLeave={() => setVoiceExamplesOpen");
    expect(hub).toContain("aria-expanded={voiceExamplesOpen}");
    expect(hub).toContain('aria-controls="voice-saved-examples"');
    expect(hub).toContain("onClick={() => setVoiceExamplesOpen((open) => !open)}");
    expect(hub).toContain("<span>Saved examples</span>");
    expect(hub).toContain("<b>{voiceExamples.length}</b>");
    // The rows and their × are unchanged, now inside the box.
    const box = hub.slice(hub.indexOf('<div className={styles.exampleDrawerBox} id="voice-saved-examples">'));
    const boxBody = box.slice(0, box.indexOf("</div>"));
    expect(boxBody).toContain("<ul className={styles.exampleList}>");
    expect(boxBody).toContain("aria-label={`Delete example ${index + 1}`}");
    expect(boxBody).toContain("onClick={() => removeVoiceExample(index)}");
    // The box only renders while there is something to show, and deleting the last row closes it.
    expect(hub).toContain("{voiceExamples.length > 0 ? (\n                        <div\n                          className={`${styles.exampleDrawer} ${voiceExamplesOpen ? styles.exampleDrawerOpen : \"\"}`}");
    expect(hub).toContain("if (next.length === 0) setVoiceExamplesOpen(false);");
  });

  it("never snaps shut mid-travel: leaving is delayed, re-entering cancels the delay, and unmount clears it (owner recording, 7 Sep)", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("const VOICE_EXAMPLES_HOVER_CLOSE_DELAY_MS = 220;");
    expect(hub).toContain("const voiceExamplesCloseTimerRef = useRef<number | null>(null);");
    expect(hub).toContain(
      "voiceExamplesCloseTimerRef.current = window.setTimeout(() => {\n      voiceExamplesCloseTimerRef.current = null;\n      setVoiceExamplesOpen(false);\n    }, VOICE_EXAMPLES_HOVER_CLOSE_DELAY_MS);",
    );
    // Leave never closes synchronously: the only close in the handler sits inside the setTimeout callback.
    const leave = hub.slice(hub.indexOf("function closeVoiceExamplesFromPointer"), hub.indexOf("useEffect(() => cancelVoiceExamplesClose, []);"));
    expect(leave.match(/setVoiceExamplesOpen\(false\)/g)?.length).toBe(1);
    expect(leave.indexOf("setVoiceExamplesOpen(false)")).toBeGreaterThan(leave.indexOf("window.setTimeout(() => {"));
    expect(leave).toContain("cancelVoiceExamplesClose();");
    expect(hub).toContain("useEffect(() => cancelVoiceExamplesClose, []);");
    // And the wrapper bridges the gap under the pill while open, so crossing it is not a leave at all.
    const css = await source("components", "social-hub.module.css");
    expect(css).toMatch(/\.exampleDrawerOpen::after \{\s*content: "";\s*position: absolute;\s*top: 100%;\s*left: 0;\s*right: 0;\s*height: 8px;/);
    expect(css).toContain("top: calc(100% + 8px);");
  });

  it("styles the box as a popover driven only by the open state (no CSS :hover), with a 44px trigger on touch", async () => {
    const css = await source("components", "social-hub.module.css");
    expect(css).toContain(".exampleDrawer { position: relative; }");
    expect(css).toMatch(/\.exampleDrawerBox \{\s*display: none;\s*position: absolute;/);
    expect(css).toContain(".exampleDrawerOpen .exampleDrawerBox { display: block; }");
    expect(css).not.toContain(".exampleDrawer:hover");
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.exampleDrawerToggle \{ min-height: 44px; \}/);
    // Theme variables, never hand-copied hex.
    const toggle = css.slice(css.indexOf(".exampleDrawerToggle {"), css.indexOf(".exampleDrawerToggle b"));
    expect(toggle).toContain("color: var(--text-label);");
    expect(toggle).toContain("background: var(--studio-ghost-bg);");
    const boxRule = css.slice(css.indexOf(".exampleDrawerBox {"), css.indexOf(".exampleDrawerOpen .exampleDrawerBox"));
    expect(boxRule).toContain("background: var(--panel-bg);");
    expect(boxRule).toContain("max-height: 320px;");
    expect(boxRule).toContain("overflow-y: auto;");
  });

  it("drops the Voice preview subtitle and the Tone / Vocabulary / Cadence / Emoji dump (heading only)", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).not.toContain("how it would sound writing about your project");
    expect(hub).not.toContain("Tone: {voiceProfile.tone}");
    expect(hub).not.toContain("Vocabulary: {voiceProfile.vocabulary}");
    expect(hub).toContain("<h2>Voice preview</h2>\n                        </div>\n                      </div>");
    // The profile itself still drives generation.
    expect(hub).toContain("const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null);");
  });
});

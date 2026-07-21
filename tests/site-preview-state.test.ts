import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SITE_GENERATION_TIMEOUT_MS,
  failSitePreviewGeneration,
  finishSitePreviewGeneration,
  previewFailureMessage,
  previewTimeoutMessage,
  startSitePreviewGeneration,
} from "@/lib/site-preview-state";

const ROOT = process.cwd();

describe("website preview generation state", () => {
  it("unlocks the website immediately while the AI request is still running", () => {
    expect(startSitePreviewGeneration()).toEqual({ unlocked: true, generating: true });
    expect(finishSitePreviewGeneration()).toEqual({ unlocked: true, generating: false });
  });

  it("keeps an already-visible website open when AI or inspiration generation fails", () => {
    expect(failSitePreviewGeneration(true)).toEqual({ unlocked: true, generating: false });
    expect(failSitePreviewGeneration(false)).toEqual({ unlocked: false, generating: false });
    expect(previewFailureMessage("The inspiration website could not be inspected.", true)).toBe(
      "Your website preview is shown below. The inspiration website could not be inspected.",
    );
  });

  it("ends a stuck enhancement request without hiding the website", () => {
    expect(SITE_GENERATION_TIMEOUT_MS).toBe(65_000);
    expect(previewTimeoutMessage(true)).toContain("website preview is shown below");
    expect(previewTimeoutMessage(true)).toContain("Inspiration analysis is taking too long");
    expect(previewTimeoutMessage(false)).toContain("artwork-based version remains active");
  });

  it("wires immediate unlock, scroll, timeout and preview-preserving failure into the button flow", async () => {
    const source = await readFile(
      path.join(ROOT, "components", "build-site-gate.tsx"),
      "utf8",
    );

    const startIndex = source.indexOf("const next = startSitePreviewGeneration()");
    const dispatchIndex = source.indexOf(
      'window.dispatchEvent(new CustomEvent("launchpad:generate-site", { detail }))',
    );

    expect(startIndex).toBeGreaterThan(-1);
    expect(dispatchIndex).toBeGreaterThan(startIndex);
    expect(source).toContain('document.querySelector(".preview-panel")?.scrollIntoView');
    expect(source).toContain("SITE_GENERATION_TIMEOUT_MS");
    expect(source).toContain("failSitePreviewGeneration(unlocked)");
    expect(source).toContain("previewFailureMessage(message, unlocked)");
    expect(source).not.toContain("unlocked = false;\n      const message");
  });
});

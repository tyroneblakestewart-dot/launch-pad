import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestFreeGeneratedWebsite,
  requestGeneratedWebsite,
} from "@/components/full-website-generator";

const ROOT = process.cwd();

const DETAIL = {
  name: "Journey",
  ticker: "RIDE",
  description: "A London journey token.",
  imageDataUrl: "data:image/png;base64,aGVsbG8=",
  inspirationUrl: "",
};

async function generatorSource() {
  return readFile(path.join(ROOT, "components", "full-website-generator.tsx"), "utf8");
}

async function gateSource() {
  return readFile(path.join(ROOT, "components", "build-site-gate.tsx"), "utf8");
}

async function bridgeSource() {
  return readFile(
    path.join(ROOT, "components", "generate-site-style-auth-bridge.tsx"),
    "utf8",
  );
}

describe("free-site vs bespoke generation mode wiring", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requestFreeGeneratedWebsite posts plain JSON to /api/generate-free-site and returns html", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ html: "<!doctype html><html><body>Free</body></html>" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestFreeGeneratedWebsite(DETAIL)).resolves.toEqual({
      html: "<!doctype html><html><body>Free</body></html>",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/generate-free-site");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(init.headers).not.toHaveProperty("Accept");
    expect(JSON.parse(String(init.body))).toMatchObject({ name: "Journey", ticker: "RIDE" });
  });

  it("rejects requestFreeGeneratedWebsite when the server responds without html", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "boom" }), { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestFreeGeneratedWebsite(DETAIL)).rejects.toThrow("boom");
  });

  it("keeps requestGeneratedWebsite (bespoke, NDJSON) exported alongside the new free helper", () => {
    expect(typeof requestGeneratedWebsite).toBe("function");
    expect(typeof requestFreeGeneratedWebsite).toBe("function");
  });

  it("branches onGenerate on detail.mode: bespoke streams generate-site-page, otherwise posts generate-free-site", async () => {
    const source = await generatorSource();

    const onGenerateStart = source.indexOf("async function onGenerate(event: Event) {");
    const onGenerateEnd = source.indexOf('window.addEventListener("message", onMessage);');
    expect(onGenerateStart).toBeGreaterThan(-1);
    expect(onGenerateEnd).toBeGreaterThan(onGenerateStart);
    const onGenerateBody = source.slice(onGenerateStart, onGenerateEnd);

    expect(onGenerateBody).toContain('const mode = detail.mode === "bespoke" ? "bespoke" : "free";');
    expect(onGenerateBody).toContain("mode === \"bespoke\"");
    expect(onGenerateBody).toContain("await requestGeneratedWebsite(detail");
    expect(onGenerateBody).toContain("await requestFreeGeneratedWebsite(detail");

    // Starting either mode aborts an in-flight request from the other: the abort call
    // runs unconditionally, before mode is even branched on inside the try block.
    const modeLineIndex = onGenerateBody.indexOf("const mode = detail.mode");
    const firstAbortIndex = onGenerateBody.indexOf("activeController?.abort();");
    const tryIndex = onGenerateBody.indexOf("try {");
    expect(firstAbortIndex).toBeGreaterThan(modeLineIndex);
    expect(firstAbortIndex).toBeLessThan(tryIndex);

    // Both modes converge on a single render/iframe call site (exactly one live iframe at all times).
    const renderCallCount = (onGenerateBody.match(/renderGeneratedWebsite\(page\.html/g) || [])
      .length;
    expect(renderCallCount).toBe(1);
    const iframeCreationCount = (source.match(/document\.createElement\("iframe"\)/g) || [])
      .length;
    expect(iframeCreationCount).toBe(1);
  });

  it("clears srcdoc and removes listeners on unmount regardless of which mode last ran", async () => {
    const source = await generatorSource();
    expect(source).toContain('frame.srcdoc = "";');
    expect(source.indexOf('frame.srcdoc = "";')).toBeLessThan(source.indexOf("frame.remove();"));
    expect(source).toContain('window.removeEventListener("launchpad:generate-site", onGenerate);');
    expect(source).toContain('window.removeEventListener("message", onMessage);');
    expect(source).toContain('window.removeEventListener("resize", onViewportResize);');
  });

  it("build-site-gate dispatches mode 'free' from the primary button and mode 'bespoke' from a secondary button", async () => {
    const source = await gateSource();

    expect(source).toContain('startGeneration("free")');
    expect(source).toContain('startGeneration("bespoke")');
    expect(source).toContain(">Generate a bespoke AI site<");
    expect(source).toContain("Takes longer");
    expect(source).toContain(
      'window.dispatchEvent(new CustomEvent("launchpad:generate-site", { detail }));',
    );
    // A single shared dispatch call site is used by both buttons via startGeneration(mode).
    const dispatchCount = (
      source.match(/window\.dispatchEvent\(new CustomEvent\("launchpad:generate-site"/g) || []
    ).length;
    expect(dispatchCount).toBe(1);
  });

  it("adds /api/generate-free-site to the auth bridge's protected generation routes", async () => {
    const source = await bridgeSource();
    const arrayStart = source.indexOf("const PROTECTED_GENERATION_ROUTES = [");
    const arrayEnd = source.indexOf("] as const;", arrayStart);
    expect(arrayStart).toBeGreaterThan(-1);
    expect(arrayEnd).toBeGreaterThan(arrayStart);
    const arrayBody = source.slice(arrayStart, arrayEnd);

    expect(arrayBody).toContain('"/api/generate-site-style"');
    expect(arrayBody).toContain('"/api/generate-site-page"');
    expect(arrayBody).toContain('"/api/generate-free-site"');
  });
});

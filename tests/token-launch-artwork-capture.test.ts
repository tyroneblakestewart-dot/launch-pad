import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("studio launch artwork thumbnail capture (issue #438)", () => {
  it("captures the thumbnail from the already-in-memory heroImage rather than holding it in React state", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    expect(controller).toContain(
      'import { captureTokenArtworkThumbnail } from "@/lib/token-artwork-thumbnail";',
    );
    expect(controller).toContain("captureTokenArtworkThumbnail(currentProject.heroImage)");
    // Never threaded into a useState setter alongside the deployment's own
    // React state (CLAUDE.md's PR #118 iPhone Safari memory rule).
    expect(controller).not.toMatch(/setArtwork\w*\(/);
    expect(controller).not.toMatch(/\[artwork\w*,\s*setArtwork/);
  });

  it("sends the captured thumbnail on the record request, but keeps it out of the signed challenge payload", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    const payloadIndex = controller.indexOf("const payload = {");
    const payloadEnd = controller.indexOf("};", payloadIndex);
    const payloadBlock = controller.slice(payloadIndex, payloadEnd);
    expect(payloadBlock).not.toContain("artworkThumbnail");

    const recordBodyIndex = controller.indexOf('fetch("/api/token-launches", {');
    const recordBodyBlock = controller.slice(recordBodyIndex, recordBodyIndex + 400);
    expect(recordBodyBlock).toContain("artworkThumbnail");
  });

  it("passes the captured artwork through to recordTokenLaunch when funding the curve", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    expect(controller).toContain("const artworkThumbnail = await captureTokenArtworkThumbnail(currentProject.heroImage).catch(() => null);");
    expect(controller).toContain("artworkThumbnail,\n      );");
  });
});

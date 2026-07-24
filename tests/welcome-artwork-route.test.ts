import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/assets/hoodlums-welcome/route";

const ROOT = process.cwd();

describe("GET /assets/hoodlums-welcome", () => {
  it("serves the exact WebP bytes with cache and nosniff headers", async () => {
    const response = await GET();
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Content-Length")).toBe(String(bytes.byteLength));
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=31536000");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });
});

describe("welcome modal artwork loading", () => {
  it("keeps the large base64 artwork out of the mobile client bundle", async () => {
    const modal = await readFile(
      path.join(ROOT, "components", "hoodlums-welcome-modal.tsx"),
      "utf8",
    );

    expect(modal).toContain('const WELCOME_ARTWORK_URL = "/assets/hoodlums-welcome"');
    expect(modal).toContain("src={WELCOME_ARTWORK_URL}");
    expect(modal).toContain('decoding="async"');
    expect(modal).not.toContain("hoodlums-welcome-sharp-complete-image");
    expect(modal).not.toContain('decoding="sync"');
  });
});

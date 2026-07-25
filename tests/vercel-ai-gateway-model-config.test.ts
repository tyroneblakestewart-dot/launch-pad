import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("Vercel AI Gateway production configuration", () => {
  it("uses the low-latency vision model and a long function budget", async () => {
    const raw = await readFile(path.join(ROOT, "vercel.json"), "utf8");
    const config = JSON.parse(raw) as {
      env?: Record<string, string>;
      functions?: Record<string, { maxDuration?: number }>;
    };

    expect(config.env?.AI_GATEWAY_MODEL).toBe("openai/gpt-5-nano");
    expect(
      config.functions?.["app/api/generate-site-page/route.ts"]?.maxDuration,
    ).toBe(180);
  });
});

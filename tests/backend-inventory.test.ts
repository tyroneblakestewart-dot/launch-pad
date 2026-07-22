import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(absolute);
      return [absolute];
    }),
  );
  return files.flat();
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

describe("backend test inventory", () => {
  it("lists every current API route and its exported HTTP method", async () => {
    const routeFiles = (await walk(path.join(ROOT, "app", "api")))
      .filter((file) => file.endsWith(`${path.sep}route.ts`))
      .map(relative)
      .sort();

    expect(routeFiles).toEqual([
      "app/api/dexscreener-pair/route.ts",
      "app/api/generate-site-page/route.ts",
      "app/api/generate-site-style/route.ts",
      "app/api/social/telegram/route.ts",
    ]);

    const methods = await Promise.all(
      routeFiles.map(async (file) => {
        const source = await readFile(path.join(ROOT, file), "utf8");
        const exported = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)]
          .map((match) => match[1])
          .sort();
        return [file, exported] as const;
      }),
    );

    expect(Object.fromEntries(methods)).toEqual({
      "app/api/dexscreener-pair/route.ts": ["GET"],
      "app/api/generate-site-page/route.ts": ["POST"],
      "app/api/generate-site-style/route.ts": ["POST"],
      "app/api/social/telegram/route.ts": ["POST"],
    });
  });

  it("lists every extracted server module covered by the suite", async () => {
    const serverFiles = (await walk(path.join(ROOT, "lib", "server")))
      .filter((file) => file.endsWith(".ts"))
      .map(relative)
      .sort();

    expect(serverFiles).toEqual([
      "lib/server/ai-responses-runtime.ts",
      "lib/server/api-protection.ts",
      "lib/server/dexscreener.ts",
      "lib/server/generate-site-style.ts",
      "lib/server/telegram.ts",
    ]);
  });
});

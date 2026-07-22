import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const SCAN_ROOTS = ["app", "components", "lib"];
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".next", ".git"]);

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) return [];
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(absolute);
      return [absolute];
    }),
  );
  return files.flat();
}

describe("wallet provider consistency", () => {
  it("uses the shared getInjectedEvmProvider helper on every page the issue called out", async () => {
    const targets = [
      "components/provider-launcher.tsx",
      "components/token-allocation-desk.tsx",
      "components/testnet-launcher.tsx",
      "components/liquidity-lab.tsx",
    ];

    for (const target of targets) {
      const source = await readFile(path.join(ROOT, target), "utf8");
      expect(source).toContain('import { getInjectedEvmProvider } from "@/lib/wallet-provider";');
      expect(source).toContain("getInjectedEvmProvider()");
      expect(source).not.toMatch(/window\.ethereum/);
    }
  });

  it("does not leave a raw window.ethereum read alongside the shared helper", async () => {
    const providerLauncher = await readFile(
      path.join(ROOT, "components", "provider-launcher.tsx"),
      "utf8",
    );
    expect(providerLauncher).not.toContain("declare global");
  });

  // The placeholder domain scan only covers app code (app/, components/, lib/) -
  // this test file's own source lives in tests/ and mentions the placeholder
  // string itself, so scanning the repo root here would make this test fail
  // against its own contents.
  it("never references the placeholder your-domain.com anywhere in app code", async () => {
    const files = (
      await Promise.all(SCAN_ROOTS.map((root) => walk(path.join(ROOT, root))))
    ).flat();

    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (source.includes("your-domain.com")) {
        offenders.push(path.relative(ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});

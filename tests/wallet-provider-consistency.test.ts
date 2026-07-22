import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
      if (entry.isDirectory()) return walk(absolute);
      return [absolute];
    }),
  );
  return files.flat();
}

describe("wallet provider selection is unified across pages", () => {
  const PAGES = [
    "components/provider-launcher.tsx",
    "components/token-allocation-desk.tsx",
    "components/testnet-launcher.tsx",
    "components/liquidity-lab.tsx",
  ];

  it("imports the shared getInjectedEvmProvider helper on the Providers, Allocations, Testnet and Liquidity Lab pages", async () => {
    for (const file of PAGES) {
      const source = await readFile(path.join(ROOT, file), "utf8");
      expect(source, `${file} should import the shared wallet-provider helper`).toContain(
        'from "@/lib/wallet-provider"',
      );
      expect(source, `${file} should call getInjectedEvmProvider`).toContain(
        "getInjectedEvmProvider(",
      );
    }
  });

  it("never reads window.ethereum directly on those pages", async () => {
    for (const file of PAGES) {
      const source = await readFile(path.join(ROOT, file), "utf8");
      expect(source, `${file} should not access window.ethereum directly`).not.toMatch(
        /window\.ethereum/,
      );
    }
  });
});

describe("provider links use the live Hoodlums domain", () => {
  it("never references the placeholder your-domain.com host anywhere in the app", async () => {
    const files = (await walk(ROOT)).filter(
      (file) =>
        !file.includes(`${path.sep}node_modules${path.sep}`) &&
        !file.includes(`${path.sep}.next${path.sep}`) &&
        !file.includes(`${path.sep}.git${path.sep}`) &&
        /\.(tsx?|jsx?|md)$/.test(file),
    );

    const offenders: string[] = [];
    await Promise.all(
      files.map(async (file) => {
        const source = await readFile(file, "utf8");
        if (source.includes("your-domain.com")) offenders.push(path.relative(ROOT, file));
      }),
    );

    expect(offenders).toEqual([]);
  });

  it("builds project website links from https://hoodlums.dev", async () => {
    const socialHub = await readFile(path.join(ROOT, "components", "social-hub.tsx"), "utf8");
    const providerLauncher = await readFile(
      path.join(ROOT, "components", "provider-launcher.tsx"),
      "utf8",
    );

    expect(socialHub).toContain("https://hoodlums.dev/${project.websiteSlug}");
    expect(providerLauncher).toContain("https://hoodlums.dev/${project.websiteSlug}");
  });
});

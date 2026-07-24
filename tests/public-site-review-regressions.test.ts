import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import PublicGeneratedSitePage, { generateMetadata } from "@/app/[slug]/page";
import { notFound } from "next/navigation";
import {
  resetPublicGeneratedSiteAdapterForTests,
  setPublicGeneratedSiteAdapter,
} from "@/lib/server/public-generated-sites";
import type { PublicGeneratedSite } from "@/lib/public-site";

const ROOT = process.cwd();
const FIXTURE: PublicGeneratedSite = {
  slug: "different-slug",
  name: "Wrong record",
  ticker: "WRONG",
  description: "A deliberately mismatched adapter record.",
  supply: "1",
  decimals: 18,
  chain: "robinhood",
  heroImage: "",
  generatedSiteHtml: null,
  contractAddress: "",
  xHandle: "",
  telegram: "",
  status: "draft",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function notFoundDigest(): string {
  try {
    notFound();
  } catch (error) {
    return (error as { digest?: string }).digest || "";
  }
  throw new Error("notFound() did not throw");
}

afterEach(() => resetPublicGeneratedSiteAdapterForTests());

describe("public-site review regressions", () => {
  it("rejects an adapter record whose slug does not match the requested path", async () => {
    setPublicGeneratedSiteAdapter(async () => FIXTURE);
    const digest = notFoundDigest();
    await expect(
      PublicGeneratedSitePage({ params: Promise.resolve({ slug: "requested-slug" }) }),
    ).rejects.toMatchObject({ digest });
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "requested-slug" }) }),
    ).resolves.toEqual({});
  });

  it("wires explicit save results and stales generated HTML on description changes", async () => {
    const studio = await readFile(path.join(ROOT, "components/token-studio.tsx"), "utf8");
    const workspace = await readFile(path.join(ROOT, "components/token-studio-workspace.tsx"), "utf8");
    expect(studio).toContain("PROJECT_SAVE_RESULT_EVENT");
    expect(studio).toContain("detail: { success: false }");
    expect(studio).toContain("detail: { success: true }");
    expect(studio).toContain('"description",');
    expect(workspace).toContain("shouldCloseWorkspaceAfterSave(detail)");
    expect(workspace).toContain("awaitingSaveAndClose.current = true");
  });

  it("removes private workspace chrome before hydration on public pages", async () => {
    const css = await readFile(path.join(ROOT, "components/app-navigation.module.css"), "utf8");
    expect(css).toContain("body:has(.public-generated-site)");
    expect(css).toContain("padding-left:0 !important");
    expect(css).toContain(".sidebar");
    expect(css).toContain(".mobileHeader");
    expect(css).toContain(".bottomNav");
  });

  it("uses strict artwork validation, nosniff and the narrow lint fix", async () => {
    const page = await readFile(path.join(ROOT, "app/[slug]/page.tsx"), "utf8");
    const artworkRoute = await readFile(path.join(ROOT, "app/[slug]/artwork/route.ts"), "utf8");
    const liquidity = await readFile(path.join(ROOT, "components/liquidity-lab.tsx"), "utf8");
    expect(page).toContain("Boolean(decodeArtworkDataUrl(site.heroImage))");
    expect(artworkRoute).toContain('"X-Content-Type-Options": "nosniff"');
    expect(liquidity).toContain('import Link from "next/link"');
    expect(liquidity).toContain('<Link className={styles.back} href="/allocations">');
  });
});

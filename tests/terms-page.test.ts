import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findPageDefinition } from "@/lib/page-content-registry";

const ROOT = process.cwd();

async function source(file: string) {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("terms of use page", () => {
  it("registers /terms in the CMS registry so the admin Pages section lists it", () => {
    const terms = findPageDefinition("terms");
    expect(terms).toBeTruthy();
    expect(terms?.route).toBe("/terms");
    // Editable header elements the admin cockpit can manage.
    const elementIds = terms?.elements.map((element) => element.id) ?? [];
    expect(elementIds).toEqual(expect.arrayContaining(["eyebrow", "title", "intro", "effective_date"]));
  });

  it("renders the header from resolved CMS content", async () => {
    const page = await source("app/(app)/terms/page.tsx");
    expect(page).toContain('resolvePageContent(\n    "terms"');
    expect(page).toContain("content.eyebrow");
    expect(page).toContain("content.title");
    expect(page).toContain("content.effective_date");
  });

  it("keeps the legal entity and contact as findable placeholders, not an invented company", async () => {
    const page = await source("app/(app)/terms/page.tsx");
    expect(page).toContain("[LEGAL ENTITY NAME]");
    expect(page).toContain("legal@hoodlums.dev");
    // The draft warning must stay visible on the page itself.
    expect(page).toContain("Draft — not legal advice.");
  });

  it("uses the chosen Georgia / Atlanta governing law and dispute resolution", async () => {
    const page = await source("app/(app)/terms/page.tsx");
    expect(page).toContain("laws of the State of Georgia");
    expect(page).toContain("seated in Atlanta, Georgia");
    expect(page).toContain("courts located in Atlanta, Georgia");
    // Individual-arbitration class-action waiver is retained.
    expect(page).toContain("NOT AS A PLAINTIFF OR CLASS MEMBER");
  });

  it("covers the required terms-of-use sections including HOODLUMS-specific features", async () => {
    const page = await source("app/(app)/terms/page.tsx");
    for (const title of [
      "Noncustodial interface",
      "Wallets and account security",
      "Token launches and content",
      "Trading and liquidity",
      "Risk disclosures",
      "Acceptable use",
      "Limitation of liability",
      "Governing law and dispute resolution",
    ]) {
      expect(page).toContain(title);
    }
    // Non-custodial posture: never asks for keys/seed phrase.
    expect(page).toContain("will never ask for your private key or recovery phrase");
    // HOODLUMS-specific: AI site generation and the testnet chains.
    expect(page).toContain("AI systems to help generate token websites");
    expect(page).toContain("46630");
    expect(page).toContain("10143");
  });
});

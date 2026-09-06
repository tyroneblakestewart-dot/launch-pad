import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicTokenFallback } from "@/components/public-token-fallback";
import type { PublicGeneratedSite } from "@/lib/public-site";

const ROOT = process.cwd();

function baseSite(overrides: Partial<PublicGeneratedSite> = {}): PublicGeneratedSite {
  return {
    slug: "doggo",
    name: "Doggo",
    ticker: "DOGGO",
    description: "A very good token.",
    supply: "1000000",
    decimals: 9,
    chain: "solana",
    heroImage: "",
    generatedSiteHtml: null,
    contractAddress: "",
    xHandle: "",
    telegram: "",
    status: "launched",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function render(site: PublicGeneratedSite): string {
  return renderToStaticMarkup(createElement(PublicTokenFallback, { site }));
}

describe("PublicTokenFallback socials", () => {
  it("renders the same href for a URL, @ and bare-form X handle", () => {
    const urlHref = render(baseSite({ xHandle: "https://x.com/doggocreator" }));
    const atHref = render(baseSite({ xHandle: "@doggocreator" }));
    const bareHref = render(baseSite({ xHandle: "doggocreator" }));

    for (const html of [urlHref, atHref, bareHref]) {
      expect(html).toContain('href="https://x.com/doggocreator"');
    }
  });

  it("maps a twitter.com URL to an x.com href", () => {
    const html = render(baseSite({ xHandle: "https://twitter.com/doggocreator" }));
    expect(html).toContain('href="https://x.com/doggocreator"');
  });

  it("renders the same href for a t.me URL, schemeless, @ and bare-form Telegram handle", () => {
    const urlHref = render(baseSite({ telegram: "https://t.me/doggochat" }));
    const schemelessHref = render(baseSite({ telegram: "t.me/doggochat" }));
    const atHref = render(baseSite({ telegram: "@doggochat" }));
    const bareHref = render(baseSite({ telegram: "doggochat" }));

    for (const html of [urlHref, schemelessHref, atHref, bareHref]) {
      expect(html).toContain('href="https://t.me/doggochat"');
    }
  });

  it("marks social links as external with target and rel attributes", () => {
    const html = render(baseSite({ xHandle: "doggocreator", telegram: "doggochat" }));
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders unrecognised values as plain text, never as a link, and never puts the raw string in an href", () => {
    const cases = ["javascript:alert(1)", "https://evil.com/doggocreator"];
    for (const raw of cases) {
      const html = render(baseSite({ xHandle: raw }));
      expect(html).not.toContain("<a ");
      expect(html).not.toContain(`href="${raw}"`);
      expect(html).toContain(raw);
    }
  });

  it("falls back to plain text for an unrecognised Telegram value (legacy joinchat link)", () => {
    const html = render(baseSite({ telegram: "https://t.me/joinchat/AAAAAEabcdef" }));
    expect(html).not.toContain("<a ");
    expect(html).toContain("https://t.me/joinchat/AAAAAEabcdef");
  });

  it("renders neither socials row when both are absent, and does not crash", () => {
    const html = render(baseSite());
    expect(html).not.toContain('class="public-token-fallback-socials"');
    expect(html).not.toContain("<a ");
  });

  it("still renders the rest of the page markup untouched", () => {
    const html = render(baseSite({ xHandle: "doggocreator" }));
    expect(html).toContain("$DOGGO");
    expect(html).toContain("Doggo");
  });
});

describe("brand icon source of truth", () => {
  it("brand-icons.tsx is the only module exporting XMark/TelegramMark, and no parallel icon module exists", async () => {
    const componentsDir = path.join(ROOT, "components");
    const brandIcons = await readFile(path.join(componentsDir, "brand-icons.tsx"), "utf8");
    expect(brandIcons).toContain("export function XMark");
    expect(brandIcons).toContain("export function TelegramMark");

    await expect(readFile(path.join(componentsDir, "icons", "social-icons.tsx"), "utf8")).rejects.toThrow();

    const publicTokenFallback = await readFile(path.join(componentsDir, "public-token-fallback.tsx"), "utf8");
    expect(publicTokenFallback).toContain('from "@/components/brand-icons"');

    const tokenStudio = await readFile(path.join(componentsDir, "token-studio.tsx"), "utf8");
    expect(tokenStudio).toContain('import { TelegramMark, XMark } from "@/components/brand-icons"');
  });

  it("the studio form's X handle and Telegram icons are decorative, not links", async () => {
    const componentsDir = path.join(ROOT, "components");
    const tokenStudio = await readFile(path.join(componentsDir, "token-studio.tsx"), "utf8");

    expect(tokenStudio).toContain("<XMark aria-hidden=\"true\" focusable=\"false\" />");
    expect(tokenStudio).toContain("<TelegramMark aria-hidden=\"true\" focusable=\"false\" />");

    expect(tokenStudio).toContain('<span className="field-label">X handle</span>');
    expect(tokenStudio).toContain('<span className="field-label">Telegram</span>');
    expect(tokenStudio).toContain('onChange={(event) => updateProject("xHandle", event.target.value)}');
    expect(tokenStudio).toContain('onChange={(event) => updateProject("telegram", event.target.value)}');
  });
});

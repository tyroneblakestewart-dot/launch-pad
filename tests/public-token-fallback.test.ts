import { describe, expect, it } from "vitest";
import { PublicTokenFallback } from "@/components/public-token-fallback";
import { TelegramIcon, XIcon } from "@/components/icons/social-icons";
import type { PublicGeneratedSite } from "@/lib/public-site";

const BASE_SITE: PublicGeneratedSite = {
  slug: "hoodlums",
  name: "Hoodlums",
  ticker: "HOOD",
  description: "The code-running crew taking meme culture to a new chain.",
  supply: "1000000000",
  decimals: 18,
  chain: "robinhood",
  heroImage: "",
  generatedSiteHtml: null,
  contractAddress: "",
  xHandle: "",
  telegram: "",
  status: "launched",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

type SocialsRow = { type: unknown; props: { children: unknown[] } } | null;

function socialsRow(site: PublicGeneratedSite): SocialsRow {
  const element = PublicTokenFallback({ site });
  const children = element.props.children as unknown[];
  // <p class="ticker">, <h1>, description?, socials?, <dl>, <style> — the
  // socials row is whichever non-null entry carries the "socials" className.
  return (
    (children.find(
      (child) =>
        child !== null &&
        typeof child === "object" &&
        (child as { props?: { className?: string } }).props?.className === "public-token-fallback-socials",
    ) as SocialsRow) || null
  );
}

function socialLinks(site: PublicGeneratedSite): Array<{ type: unknown; props: { href: string; children: unknown[] } }> {
  const row = socialsRow(site);
  if (!row) return [];
  return (row.props.children as unknown[]).filter(Boolean) as Array<{
    type: unknown;
    props: { href: string; children: unknown[] };
  }>;
}

describe("PublicTokenFallback social links", () => {
  it("renders no social buttons when neither handle is set", () => {
    expect(socialsRow(BASE_SITE)).toBeNull();
  });

  it("renders a clickable X button linking to https://x.com/<handle> when xHandle is set", () => {
    const links = socialLinks({ ...BASE_SITE, xHandle: "@hoodlums" });
    expect(links).toHaveLength(1);
    expect(links[0].props.href).toBe("https://x.com/hoodlums");
    const iconChild = (links[0].props.children as unknown[]).find(
      (child) => child !== null && typeof child === "object",
    ) as { type: unknown };
    expect(iconChild.type).toBe(XIcon);
  });

  it("renders a clickable Telegram button linking to https://t.me/<handle> when telegram is set", () => {
    const links = socialLinks({ ...BASE_SITE, telegram: "t.me/hoodlums" });
    expect(links).toHaveLength(1);
    expect(links[0].props.href).toBe("https://t.me/hoodlums");
    const iconChild = (links[0].props.children as unknown[]).find(
      (child) => child !== null && typeof child === "object",
    ) as { type: unknown };
    expect(iconChild.type).toBe(TelegramIcon);
  });

  it("normalises a bare handle, an @handle and a full URL to the same profile URL", () => {
    expect(socialLinks({ ...BASE_SITE, xHandle: "hoodlums" })[0].props.href).toBe("https://x.com/hoodlums");
    expect(socialLinks({ ...BASE_SITE, xHandle: "@hoodlums" })[0].props.href).toBe("https://x.com/hoodlums");
    expect(socialLinks({ ...BASE_SITE, xHandle: "https://x.com/hoodlums" })[0].props.href).toBe(
      "https://x.com/hoodlums",
    );
  });

  it("renders both buttons when both handles are set", () => {
    const links = socialLinks({ ...BASE_SITE, xHandle: "@hoodlums", telegram: "hoodlums" });
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.props.href)).toEqual(["https://x.com/hoodlums", "https://t.me/hoodlums"]);
  });

  it("opens social links in a new tab", () => {
    const links = socialLinks({ ...BASE_SITE, xHandle: "@hoodlums", telegram: "hoodlums" });
    for (const link of links) {
      expect((link as unknown as { props: { target: string; rel: string } }).props.target).toBe("_blank");
      expect((link as unknown as { props: { target: string; rel: string } }).props.rel).toBe("noreferrer");
    }
  });

  it("hides the X button when xHandle is only whitespace or a stripped-away prefix", () => {
    expect(socialsRow({ ...BASE_SITE, xHandle: "   " })).toBeNull();
    expect(socialsRow({ ...BASE_SITE, xHandle: "@" })).toBeNull();
  });
});

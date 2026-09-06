// Real links on the bespoke site (owner direction, 6 Sep 2026): the paid AI
// page links to the project's real X / Telegram, its Hoodlums trade page and
// the block explorer — never to invented accounts or exchanges. The same
// handle normaliser now serves the free-site template, so a pasted full
// address is a clean handle there too.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BESPOKE_LINKS_MARKER,
  BESPOKE_LINK_PLACEHOLDERS,
  CONTRACT_PENDING_LABEL,
  buildBespokeLinkRules,
  enforceBespokeLinks,
  isBespokeLinksHtml,
  normaliseSocialHandle,
  normaliseTelegramHandle,
  normaliseXHandle,
  substituteBespokePlatformFacts,
} from "@/lib/bespoke-site-links";
import { normaliseGenerateSiteStyleRequest } from "@/lib/server/generate-site-style";
import { buildGeneratedSitePageRequestBody } from "@/lib/site-page-openai-pipeline";
import type { ArtworkIdentity } from "@/lib/site-style-openai-pipeline";

const ROOT = process.cwd();
async function source(relative: string) {
  return readFile(path.join(ROOT, relative), "utf8");
}
const ARTWORK: ArtworkIdentity = {
  dominantColours: "Lime and charcoal.",
  memeEnergy: "Playful.",
  subjectAndIcons: "A cat.",
  visibleText: "None.",
  typographyPersonality: "Rounded.",
  copyVoice: "Warm.",
  nonNegotiables: "Keep the cat.",
};
const CONTRACT = "0x39207baa4d0a30a5194770563ec586978c9fbcb3";

describe("social handle normaliser", () => {
  it("turns every way a user pastes a handle into the plain handle", () => {
    for (const raw of ["hoodlums", "@hoodlums", " @hoodlums ", "x.com/hoodlums", "twitter.com/@hoodlums", "https://x.com/hoodlums", "https://www.twitter.com/hoodlums/", "HTTPS://X.COM/hoodlums?s=21"]) {
      expect(normaliseXHandle(raw)).toBe("hoodlums");
    }
    for (const raw of ["hoodlums", "@hoodlums", "t.me/hoodlums", "https://t.me/hoodlums", "telegram.me/hoodlums", "https://t.me/hoodlums?start=1"]) {
      expect(normaliseTelegramHandle(raw)).toBe("hoodlums");
    }
  });

  it("refuses anything that is not a plain handle, so it can never reach an href", () => {
    for (const raw of ["", "   ", "hood lums", "hood<lums>", "javascript:alert(1)", "https://evil.example/hoodlums", "a".repeat(33)]) {
      expect(normaliseXHandle(raw)).toBe("");
    }
    expect(normaliseSocialHandle("t.me/hoodlums", ["x.com/"])).toBe("");
  });
});

describe("prompt link rules", () => {
  it("names the exact placeholders, the real handles, and forbids every other outbound link", () => {
    const lines = buildBespokeLinkRules({ xHandle: "@hoodlums", telegram: "https://t.me/hoodchat" }).join("\n");
    expect(lines).toContain(`href is exactly ${BESPOKE_LINK_PLACEHOLDERS.buy}`);
    expect(lines).toContain(`href="${BESPOKE_LINK_PLACEHOLDERS.explorer}"`);
    expect(lines).toContain(`print exactly ${BESPOKE_LINK_PLACEHOLDERS.contract}`);
    expect(lines).toContain("The project's X account is @hoodlums");
    expect(lines).toContain(`href="${BESPOKE_LINK_PLACEHOLDERS.xHref}"`);
    expect(lines).toContain("The project's Telegram is t.me/hoodchat");
    expect(lines).toContain(`href="${BESPOKE_LINK_PLACEHOLDERS.telegramHref}"`);
    expect(lines).toContain("Do not link to Dexscreener, Uniswap, Raydium, Jupiter, pump.fun");
    expect(lines).toContain("No other external links of any kind");
  });

  it("tells the model to leave a social out entirely when no handle was given", () => {
    const lines = buildBespokeLinkRules({ xHandle: "", telegram: "" }).join("\n");
    expect(lines).toContain("No X account was supplied: do not include any X / Twitter link or handle.");
    expect(lines).toContain("No Telegram was supplied: do not include any Telegram link.");
    expect(lines).not.toContain(BESPOKE_LINK_PLACEHOLDERS.xHref);
  });

  it("reaches the bespoke request body from the normalised request", () => {
    const request = normaliseGenerateSiteStyleRequest({
      name: "Sherwood Cat", ticker: "SWCAT", description: "A community token with a story.", imageDataUrl: "data:image/png;base64,aGVsbG8=",
      xHandle: "https://x.com/sherwoodcat", telegram: "@sherwood_cat",
    });
    expect(request.xHandle).toBe("sherwoodcat");
    expect(request.telegram).toBe("sherwood_cat");
    const body = buildGeneratedSitePageRequestBody(request, "gpt-5", ARTWORK);
    const developer = JSON.stringify(body);
    expect(developer).toContain("LINKS (NON-NEGOTIABLE");
    expect(developer).toContain("The project's X account is @sherwoodcat");
    expect(developer).toContain("The project's Telegram is t.me/sherwood_cat");
  });
});

describe("enforceBespokeLinks (generation time)", () => {
  const page = `<!doctype html><html><head><title>t</title></head><body class="x"><a href="{{BUY_HREF}}">Buy</a><a href="{{X_HREF}}">@{{X_HANDLE}}</a><a href="{{TELEGRAM_HREF}}">t.me/{{TELEGRAM}}</a><a href='https://twitter.com/someoneelse'>X</a><a href="https://dexscreener.com/ethereum/0xabc">Chart</a><a href="https://app.uniswap.org/swap?x=1">Swap</a><a href="https://robinhoodchain.blockscout.com/address/0xabc">Explorer</a><a href="https://docs.example.com/whitepaper">Docs</a><a href="#how-to-buy">How</a><code>{{CONTRACT_ADDRESS}}</code></body></html>`;

  it("fills the real handles, re-aims invented social / venue / explorer links, keeps docs and in-page anchors, and stamps the marker", () => {
    const out = enforceBespokeLinks(page, { xHandle: "@hoodlums", telegram: "hoodchat" });
    expect(out).toContain('<a href="https://x.com/hoodlums">@hoodlums</a>');
    expect(out).toContain('<a href="https://t.me/hoodchat">t.me/hoodchat</a>');
    expect(out).toContain("<a href='https://x.com/hoodlums'>X</a>");
    expect(out).not.toContain("someoneelse");
    expect(out).toContain('<a href="{{BUY_HREF}}">Chart</a>');
    expect(out).toContain('<a href="{{BUY_HREF}}">Swap</a>');
    expect(out).toContain('<a href="{{EXPLORER_URL}}">Explorer</a>');
    expect(out).toContain('<a href="https://docs.example.com/whitepaper">Docs</a>');
    expect(out).toContain('<a href="#how-to-buy">How</a>');
    expect(out).toContain("{{CONTRACT_ADDRESS}}");
    expect(out).toContain(`<body class="x">${BESPOKE_LINKS_MARKER}`);
    expect(isBespokeLinksHtml(out)).toBe(true);
    expect(isBespokeLinksHtml(page)).toBe(false);
  });

  it("sends an invented social link nowhere when no real handle exists", () => {
    const out = enforceBespokeLinks(page, { xHandle: "", telegram: "" });
    expect(out).toContain("<a href='#'>X</a>");
    expect(out).toContain('<a href="#">@</a>');
    expect(out).not.toContain("x.com/");
    expect(out).not.toContain("t.me/hood");
  });

  it("escapes anything unexpected and never adds a second marker", () => {
    const once = enforceBespokeLinks(page, { xHandle: "hoodlums", telegram: "" });
    const twice = enforceBespokeLinks(once, { xHandle: "hoodlums", telegram: "" });
    expect(twice.split(BESPOKE_LINKS_MARKER)).toHaveLength(2);
    expect(enforceBespokeLinks(page, { xHandle: '"><script>', telegram: "" })).not.toContain("<script>");
  });
});

describe("substituteBespokePlatformFacts (serve time)", () => {
  const stored = `<body>${BESPOKE_LINKS_MARKER}<a href="{{BUY_HREF}}">Buy</a><a href="{{TRADE_URL}}">Trade</a><a href="{{EXPLORER_URL}}">Explorer</a><code>{{CONTRACT_ADDRESS}}</code></body>`;

  it("points Buy at the Hoodlums trade page and the explorer at the contract once launched", () => {
    const out = substituteBespokePlatformFacts(stored, { contractAddress: CONTRACT, chain: "robinhood" });
    expect(out).toContain(`href="https://hoodlums.dev/token/robinhood/${CONTRACT}">Buy`);
    expect(out).toContain(`href="https://hoodlums.dev/token/robinhood/${CONTRACT}">Trade`);
    expect(out).toMatch(/href="https:\/\/[^"]+\/address\/0x39207baa4d0a30a5194770563ec586978c9fbcb3">Explorer/);
    expect(out).toContain(`<code>${CONTRACT}</code>`);
  });

  it("goes nowhere and says so before the contract exists", () => {
    const out = substituteBespokePlatformFacts(stored, { contractAddress: "" });
    expect(out).toContain('href="#">Buy');
    expect(out).toContain('href="#">Explorer');
    expect(out).toContain(`<code>${CONTRACT_PENDING_LABEL}</code>`);
  });
});

describe("wiring", () => {
  it("runs the enforcement on the delivered page and substitutes at serve time and in the studio preview", async () => {
    const route = await source("app/api/generate-site-page/route.ts");
    expect(route).toContain('const deliveredHtml = enforceBespokeLinks(page.html, { xHandle: input.xHandle ?? "", telegram: input.telegram ?? "" });');
    expect(route).toContain("html: deliveredHtml,");
    const slug = await source("app/[slug]/page.tsx");
    expect(slug).toContain("isBespokeLinksHtml(site.generatedSiteHtml as string)");
    expect(slug).toContain("html = substituteBespokePlatformFacts(site.generatedSiteHtml as string, {");
    const generator = await source("components/full-website-generator.tsx");
    expect(generator).toContain("if (isBespokeLinksHtml(rawHtml)) return substituteBespokePlatformFacts(rawHtml, { contractAddress, chain });");
    const template = await source("lib/free-site-template.ts");
    expect(template).toContain("return normaliseSocialHandle(raw, domainPrefixes);");
  });

  it("removed the inspiration website URL from the studio (owner decision, 6 Sep 2026)", async () => {
    const gate = await source("components/build-site-gate.tsx");
    expect(gate).not.toContain("Inspiration website URL");
    expect(gate).not.toContain("ensureInspirationField");
    expect(gate).not.toContain("Valid inspiration website URL");
    expect(gate).toContain('inspirationUrl: "",');
    const fields = await source("lib/launch-path-fields.ts");
    expect(fields).not.toContain("inspirationUrl");
  });
});

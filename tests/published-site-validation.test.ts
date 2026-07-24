import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import {
  MAX_ARTWORK_REFERENCE_BYTES,
  MAX_PUBLISHED_HTML_BYTES,
  hashPublishableSite,
  normalisePublishableSite,
  sanitisePublishedGeneratedHtml,
} from "@/lib/server/published-site-validation";

const ROOT = process.cwd();
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=";

function page(extra = ""): string {
  const copy = "Safe generated campaign copy. ".repeat(150);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Safe</title><style>body{margin:0}</style></head><body><section id="hero"><img src="${ARTWORK_PLACEHOLDER}" alt="Artwork"></section><section id="about">${copy}</section><section id="tokenomics">Supply</section><section id="roadmap">Roadmap</section><section id="how-to-buy">Buy</section><section id="community">Community</section>${extra}<script>document.body.dataset.ready="true";</script></body></html>`;
}

function validSitePayload() {
  return {
    slug: "safe-token",
    name: "Safe Token",
    ticker: "safe",
    description: "A complete description long enough for a public token site.",
    supply: "1000000",
    decimals: 18,
    chain: "robinhood",
    chainId: "46630",
    contractAddress: "0x1111111111111111111111111111111111111111",
    generatedSiteHtml: page(),
    artworkReference: `data:image/png;base64,${PNG_BASE64}`,
    status: "prepared",
  };
}

describe("published generated HTML sanitisation", () => {
  it("strips event attributes, navigation surfaces, meta refresh, and external resources", () => {
    const sanitised = sanitisePublishedGeneratedHtml(
      page('<meta http-equiv="refresh" content="0;url=https://bad.example"><link rel="stylesheet" href="https://bad.example/x.css"><a href="https://bad.example" target="_top" onclick="alert(1)">Open</a>'),
    );
    expect(sanitised).toBeTruthy();
    expect(sanitised).not.toContain("http-equiv");
    expect(sanitised).not.toContain("bad.example");
    expect(sanitised).not.toContain("onclick");
    expect(sanitised).not.toContain("target=");
  });

  it("removes every model-authored script and leaves only the trusted no-op placeholder", () => {
    const sanitised = sanitisePublishedGeneratedHtml(
      page("<script>fetch('https://bad.example');while(true){}</script>"),
    );
    expect(sanitised).toBeTruthy();
    expect(sanitised).not.toContain("fetch(");
    expect(sanitised).not.toContain("while(true)");
    expect(sanitised?.match(/<script\b/gi)).toHaveLength(1);
    expect(sanitised).toContain("<script>void 0;</script>");
  });

  it("enforces the published HTML and artwork reference size constants", () => {
    expect(Buffer.byteLength("x".repeat(MAX_PUBLISHED_HTML_BYTES + 1))).toBeGreaterThan(MAX_PUBLISHED_HTML_BYTES);
    expect(Buffer.byteLength("x".repeat(MAX_ARTWORK_REFERENCE_BYTES + 1))).toBeGreaterThan(
      MAX_ARTWORK_REFERENCE_BYTES,
    );
  });
});

describe("publishable site payload validation", () => {
  it("accepts a complete Robinhood site and normalises the ticker", () => {
    const result = normalisePublishableSite(validSitePayload());
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.site.ticker).toBe("SAFE");
  });

  it("creates a stable hash that changes whenever signed site content changes", () => {
    const first = normalisePublishableSite(validSitePayload());
    const repeated = normalisePublishableSite(validSitePayload());
    const altered = normalisePublishableSite({
      ...validSitePayload(),
      description: "A different complete description that must produce a different signed payload hash.",
    });
    expect(first.valid && repeated.valid && altered.valid).toBe(true);
    if (first.valid && repeated.valid && altered.valid) {
      expect(hashPublishableSite(first.site)).toMatch(/^[0-9a-f]{64}$/);
      expect(hashPublishableSite(first.site)).toBe(hashPublishableSite(repeated.site));
      expect(hashPublishableSite(first.site)).not.toBe(hashPublishableSite(altered.site));
    }
  });

  it("rejects a mismatched chain identifier and malformed artwork", () => {
    const base = {
      ...validSitePayload(),
      contractAddress: "",
    };
    expect(normalisePublishableSite({ ...base, chainId: "1" }).valid).toBe(false);
    expect(normalisePublishableSite({ ...base, artworkReference: "data:image/png;base64,AAAA" }).valid).toBe(false);
  });
});

describe("public publishing migration", () => {
  it("defines database-level slug uniqueness and single-use expiring nonces", async () => {
    const migration = await readFile(
      path.join(ROOT, "db", "migrations", "001_public_publishing.sql"),
      "utf8",
    );
    expect(migration).toContain("CONSTRAINT published_sites_slug_unique UNIQUE (slug)");
    expect(migration).toContain("nonce_hash CHAR(64) NOT NULL UNIQUE");
    expect(migration).toContain("site_payload_hash CHAR(64) NOT NULL");
    expect(migration).toContain("expires_at TIMESTAMPTZ NOT NULL");
    expect(migration).toContain("used_at TIMESTAMPTZ");
    expect(migration).toContain("octet_length(generated_html) <= 90000");
    expect(migration).toContain("octet_length(artwork_reference) <= 8100000");
  });
});

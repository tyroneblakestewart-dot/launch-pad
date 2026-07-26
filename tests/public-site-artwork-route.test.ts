import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/[slug]/artwork/route";
import {
  resetPublicGeneratedSiteAdapterForTests,
  setPublicGeneratedSiteAdapter,
} from "@/lib/server/public-generated-sites";
import type { PublicGeneratedSite } from "@/lib/public-site";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=";
const DRAFT_TOKEN = "unguessable-draft-preview-token";

const BASE_FIXTURE: PublicGeneratedSite = {
  slug: "hoodlums",
  name: "Hoodlums",
  ticker: "HOOD",
  description: "The code-running crew.",
  supply: "1000000000",
  decimals: 18,
  chain: "robinhood",
  heroImage: `data:image/png;base64,${PNG_BASE64}`,
  generatedSiteHtml: null,
  contractAddress: "",
  xHandle: "",
  telegram: "",
  status: "draft",
  visibility: "live",
  draftToken: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const DRAFT_FIXTURE: PublicGeneratedSite = {
  ...BASE_FIXTURE,
  visibility: "draft",
  draftToken: DRAFT_TOKEN,
};

function call(slug: string, previewToken = "") {
  const url = new URL(`http://localhost/${slug}/artwork`);
  if (previewToken) url.searchParams.set("preview", previewToken);
  return GET(new Request(url), {
    params: Promise.resolve({ slug }),
  });
}

afterEach(() => {
  resetPublicGeneratedSiteAdapterForTests();
});

describe("GET /[slug]/artwork", () => {
  it("keeps live artwork publicly cacheable", async () => {
    setPublicGeneratedSiteAdapter(async (slug) => (slug === "hoodlums" ? BASE_FIXTURE : null));

    const response = await call("hoodlums");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("returns 404 with no body for draft artwork without a preview token", async () => {
    setPublicGeneratedSiteAdapter(async () => DRAFT_FIXTURE);

    const response = await call("hoodlums");
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("");
  });

  it("returns 404 with no body for draft artwork with the wrong preview token", async () => {
    setPublicGeneratedSiteAdapter(async () => DRAFT_FIXTURE);

    const response = await call("hoodlums", "wrong-preview-token");
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("");
  });

  it("returns authorised draft artwork with no-store caching", async () => {
    setPublicGeneratedSiteAdapter(async () => DRAFT_FIXTURE);

    const response = await call("hoodlums", DRAFT_TOKEN);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("returns 404 for an invalid path slug without looking up a record", async () => {
    setPublicGeneratedSiteAdapter(async () => BASE_FIXTURE);
    const response = await call("Not-A-Valid-Slug!");
    expect(response.status).toBe(404);
  });

  it("returns 404 when the adapter returns a record for another slug", async () => {
    setPublicGeneratedSiteAdapter(async () => ({ ...BASE_FIXTURE, slug: "another-slug" }));
    const response = await call("hoodlums");
    expect(response.status).toBe(404);
  });

  it("returns 404 when no public record exists for the slug", async () => {
    setPublicGeneratedSiteAdapter(async () => null);
    const response = await call("hoodlums");
    expect(response.status).toBe(404);
  });

  it("returns 404 when the record has no artwork", async () => {
    setPublicGeneratedSiteAdapter(async () => ({ ...BASE_FIXTURE, heroImage: "" }));
    const response = await call("hoodlums");
    expect(response.status).toBe(404);
  });

  it("returns 404 when the artwork is not a valid image data URL", async () => {
    setPublicGeneratedSiteAdapter(async () => ({
      ...BASE_FIXTURE,
      heroImage: "https://example.com/not-a-data-url.png",
    }));
    const response = await call("hoodlums");
    expect(response.status).toBe(404);
  });
});

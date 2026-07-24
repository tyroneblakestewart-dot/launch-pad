import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/[slug]/artwork/route";
import {
  resetPublicGeneratedSiteAdapterForTests,
  setPublicGeneratedSiteAdapter,
} from "@/lib/server/public-generated-sites";
import type { PublicGeneratedSite } from "@/lib/public-site";

const PNG_BASE64 = Buffer.from("fake-png-bytes").toString("base64");

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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function call(slug: string) {
  return GET(new Request(`http://localhost/${slug}/artwork`), {
    params: Promise.resolve({ slug }),
  });
}

afterEach(() => {
  resetPublicGeneratedSiteAdapterForTests();
});

describe("GET /[slug]/artwork", () => {
  it("returns the decoded artwork bytes with the correct content type for a valid fixture", async () => {
    setPublicGeneratedSiteAdapter(async (slug) => (slug === "hoodlums" ? BASE_FIXTURE : null));

    const response = await call("hoodlums");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.toString()).toBe("fake-png-bytes");
  });

  it("returns 404 for an invalid path slug without looking up a record", async () => {
    setPublicGeneratedSiteAdapter(async () => BASE_FIXTURE);
    const response = await call("Not-A-Valid-Slug!");
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

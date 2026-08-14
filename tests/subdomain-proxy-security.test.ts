import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { SUBDOMAIN_REWRITE_HEADER } from "@/lib/subdomain-routing";
import {
  resetPublicSiteSubdomainAccessAdapterForTests,
  setPublicSiteSubdomainAccessAdapterForTests,
} from "@/lib/server/public-site-subdomain";

const ROOT = process.cwd();
const WALLET = "0x1111111111111111111111111111111111111111";

afterEach(() => {
  resetPublicSiteSubdomainAccessAdapterForTests();
  delete process.env.HOODLUMS_SUBDOMAINS_ENABLED;
});

describe("paid subdomain Proxy boundary", () => {
  it("does not trust a forged rewrite marker from a free owner", async () => {
    process.env.HOODLUMS_SUBDOMAINS_ENABLED = "true";
    setPublicSiteSubdomainAccessAdapterForTests(async (slug) => ({
      status: "path-only",
      slug,
      ownerWalletAddress: WALLET,
    }));

    const response = await proxy(
      new NextRequest("https://freetoken.hoodlums.dev/", {
        headers: {
          host: "freetoken.hoodlums.dev",
          [SUBDOMAIN_REWRITE_HEADER]: "freetoken",
        },
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Bond + Pro Site");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("keeps a draft preview token on the normal path route", async () => {
    process.env.HOODLUMS_SUBDOMAINS_ENABLED = "true";
    setPublicSiteSubdomainAccessAdapterForTests(async (slug) => ({
      status: "entitled",
      slug,
      ownerWalletAddress: WALLET,
      tier: "bond_pro_site",
      permanent: true,
    }));

    const response = await proxy(
      new NextRequest(
        "https://goldenhour.hoodlums.dev/?preview=single-use-preview",
        { headers: { host: "goldenhour.hoodlums.dev" } },
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Draft preview links remain available only");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("rewrites an entitled live root request to the existing slug page", async () => {
    process.env.HOODLUMS_SUBDOMAINS_ENABLED = "true";
    setPublicSiteSubdomainAccessAdapterForTests(async (slug) => ({
      status: "entitled",
      slug,
      ownerWalletAddress: WALLET,
      tier: "bond_pro_site",
      permanent: true,
    }));

    const response = await proxy(
      new NextRequest("https://goldenhour.hoodlums.dev/", {
        headers: { host: "goldenhour.hoodlums.dev" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/goldenhour",
    );
  });

  it("keeps the structural guardrails visible in the Proxy source", async () => {
    const source = await readFile(path.join(ROOT, "proxy.ts"), "utf8");

    expect(source).toContain("decideSubdomainRequest");
    expect(source).toContain("headers.set(SUBDOMAIN_REWRITE_HEADER, decision.slug)");
    expect(source).not.toContain(
      "if (request.headers.get(SUBDOMAIN_REWRITE_HEADER))",
    );
    expect(source).toContain('request.nextUrl.searchParams.has("preview")');
    expect(source.indexOf("decideSubdomainRequest")).toBeLessThan(
      source.indexOf("NextResponse.rewrite"),
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  GENERATE_SITE_STYLE_HEADER,
  getGenerateSiteAllowedOrigins,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";

const SECRET = "test-shared-secret";
const CUSTOM_DOMAIN = "https://hoodlums.dev";
const PRODUCTION_ALIAS_HOST = "launch-pad-tyrone-launchpad.vercel.app";

function request(origin: string, secret = SECRET) {
  return new Request(`${origin}/api/generate-site-page`, {
    method: "POST",
    headers: {
      Origin: origin,
      [GENERATE_SITE_STYLE_HEADER]: secret,
    },
  });
}

describe("website generation production-origin protection", () => {
  it("accepts the custom domain in production", () => {
    expect(
      isGenerateSiteStyleRequestAuthorised(request(CUSTOM_DOMAIN), SECRET, CUSTOM_DOMAIN, {
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_ALIAS_HOST,
      }),
    ).toBe(true);
  });

  it("also accepts Vercel's own stable production alias, not just the custom domain", () => {
    const environment = {
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_ALIAS_HOST,
    };

    expect(getGenerateSiteAllowedOrigins(CUSTOM_DOMAIN, environment)).toEqual([
      CUSTOM_DOMAIN,
      `https://${PRODUCTION_ALIAS_HOST}`,
    ]);
    expect(
      isGenerateSiteStyleRequestAuthorised(
        request(`https://${PRODUCTION_ALIAS_HOST}`),
        SECRET,
        CUSTOM_DOMAIN,
        environment,
      ),
    ).toBe(true);
  });

  it("still rejects unrelated origins and the wrong secret in production", () => {
    const environment = {
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_ALIAS_HOST,
    };

    expect(
      isGenerateSiteStyleRequestAuthorised(
        request("https://evil.example"),
        SECRET,
        CUSTOM_DOMAIN,
        environment,
      ),
    ).toBe(false);
    expect(
      isGenerateSiteStyleRequestAuthorised(
        request(CUSTOM_DOMAIN, "wrong-secret"),
        SECRET,
        CUSTOM_DOMAIN,
        environment,
      ),
    ).toBe(false);
  });

  it("does not widen the allow-list with an ephemeral VERCEL_URL in production", () => {
    const environment = {
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION_ALIAS_HOST,
      VERCEL_URL: "launch-pad-abc123-tyrone-launchpad.vercel.app",
    };

    expect(getGenerateSiteAllowedOrigins(CUSTOM_DOMAIN, environment)).toEqual([
      CUSTOM_DOMAIN,
      `https://${PRODUCTION_ALIAS_HOST}`,
    ]);
  });

  it("ignores a malformed production URL rather than broadening the allowlist", () => {
    expect(
      getGenerateSiteAllowedOrigins(CUSTOM_DOMAIN, {
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "*.vercel.app",
      }),
    ).toEqual([CUSTOM_DOMAIN]);
  });
});

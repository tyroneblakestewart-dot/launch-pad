import { describe, expect, it } from "vitest";
import {
  GENERATE_SITE_STYLE_HEADER,
  getGenerateSiteAllowedOrigins,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";

const SECRET = "test-shared-secret";
const PRODUCTION_ORIGIN = "https://hoodlums.dev";
const DEPLOYMENT_HOST = "launch-pad-o2gl-git-stream-abc-tyrone-launchpad.vercel.app";
const BRANCH_HOST = "launch-pad-o2gl-git-stream-tyrone-launchpad.vercel.app";

function request(origin: string, secret = SECRET) {
  return new Request(`${origin}/api/generate-site-page`, {
    method: "POST",
    headers: {
      Origin: origin,
      [GENERATE_SITE_STYLE_HEADER]: secret,
    },
  });
}

describe("website generation preview-origin protection", () => {
  it("keeps the configured production origin authorised", () => {
    expect(
      isGenerateSiteStyleRequestAuthorised(
        request(PRODUCTION_ORIGIN),
        SECRET,
        PRODUCTION_ORIGIN,
        { VERCEL_ENV: "production", VERCEL_URL: DEPLOYMENT_HOST },
      ),
    ).toBe(true);
  });

  it("accepts only exact Vercel system origins in preview deployments", () => {
    const environment = {
      VERCEL_ENV: "preview",
      VERCEL_URL: DEPLOYMENT_HOST,
      VERCEL_BRANCH_URL: `https://${BRANCH_HOST}/`,
    };

    expect(getGenerateSiteAllowedOrigins(PRODUCTION_ORIGIN, environment)).toEqual([
      PRODUCTION_ORIGIN,
      `https://${DEPLOYMENT_HOST}`,
      `https://${BRANCH_HOST}`,
    ]);
    expect(
      isGenerateSiteStyleRequestAuthorised(
        request(`https://${DEPLOYMENT_HOST}`),
        SECRET,
        PRODUCTION_ORIGIN,
        environment,
      ),
    ).toBe(true);
    expect(
      isGenerateSiteStyleRequestAuthorised(
        request(`https://${BRANCH_HOST}`),
        SECRET,
        PRODUCTION_ORIGIN,
        environment,
      ),
    ).toBe(true);
  });

  it("does not accept preview aliases in production", () => {
    expect(
      isGenerateSiteStyleRequestAuthorised(
        request(`https://${DEPLOYMENT_HOST}`),
        SECRET,
        PRODUCTION_ORIGIN,
        { VERCEL_ENV: "production", VERCEL_URL: DEPLOYMENT_HOST },
      ),
    ).toBe(false);
  });

  it("rejects arbitrary Vercel origins and the wrong shared secret", () => {
    const environment = {
      VERCEL_ENV: "preview",
      VERCEL_URL: DEPLOYMENT_HOST,
      VERCEL_BRANCH_URL: BRANCH_HOST,
    };

    expect(
      isGenerateSiteStyleRequestAuthorised(
        request("https://unrelated-project.vercel.app"),
        SECRET,
        PRODUCTION_ORIGIN,
        environment,
      ),
    ).toBe(false);
    expect(
      isGenerateSiteStyleRequestAuthorised(
        request(`https://${DEPLOYMENT_HOST}`, "wrong-secret"),
        SECRET,
        PRODUCTION_ORIGIN,
        environment,
      ),
    ).toBe(false);
  });

  it("ignores malformed system values rather than broadening the allowlist", () => {
    expect(
      getGenerateSiteAllowedOrigins(PRODUCTION_ORIGIN, {
        VERCEL_ENV: "preview",
        VERCEL_URL: "*.vercel.app",
        VERCEL_BRANCH_URL: "example.vercel.app/attacker-path",
      }),
    ).toEqual([PRODUCTION_ORIGIN]);
  });
});

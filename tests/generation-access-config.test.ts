import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

const configuredEnv = nextConfig.env || {};

describe("website generation access configuration", () => {
  it("always supplies matching server and browser generation tokens", () => {
    const serverToken = configuredEnv.GENERATE_SITE_STYLE_SHARED_SECRET;
    const browserToken = configuredEnv.NEXT_PUBLIC_GENERATE_SITE_STYLE_SHARED_SECRET;

    expect(typeof serverToken).toBe("string");
    expect(serverToken).not.toBe("");
    expect(browserToken).toBe(serverToken);
  });

  it("always supplies the production origin used by the API guard", () => {
    expect(configuredEnv.GENERATE_SITE_STYLE_ALLOWED_ORIGIN).toBe("https://hoodlums.dev");
  });
});

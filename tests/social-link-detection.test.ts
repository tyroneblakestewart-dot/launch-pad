import { describe, expect, it } from "vitest";
import { bodyContainsLink } from "@/lib/server/social-link-detection";

describe("bodyContainsLink: true positives", () => {
  it("detects a full https:// URL", () => {
    expect(bodyContainsLink("Check us out at https://hoodlums.dev/launch")).toBe(true);
  });

  it("detects a full http:// URL", () => {
    expect(bodyContainsLink("mirror at http://example.com")).toBe(true);
  });

  it("detects a www.-prefixed domain with no scheme", () => {
    expect(bodyContainsLink("come say gm at www.hoodlums.dev")).toBe(true);
  });

  it("detects a bare domain with no scheme or www", () => {
    expect(bodyContainsLink("more info: hoodlums.dev")).toBe(true);
  });

  it("detects a bare domain mid-sentence", () => {
    expect(bodyContainsLink("gm hoodlums, drop by hoodlums.dev for the launch")).toBe(true);
  });

  it("detects known shortener domains", () => {
    expect(bodyContainsLink("link in bio: bit.ly/hoodlums")).toBe(true);
    expect(bodyContainsLink("read more t.co/abc123")).toBe(true);
    expect(bodyContainsLink("tinyurl.com/hoodlums-launch")).toBe(true);
  });

  it("detects a subdomain", () => {
    expect(bodyContainsLink("app.hoodlums.dev is live")).toBe(true);
  });
});

describe("bodyContainsLink: false positives that must NOT be treated as links", () => {
  it("does not flag a decimal number", () => {
    expect(bodyContainsLink("price moved 3.14% today")).toBe(false);
  });

  it("does not flag a version string", () => {
    expect(bodyContainsLink("shipping v2.0 of the contract")).toBe(false);
  });

  it("does not flag a cashtag", () => {
    expect(bodyContainsLink("$HOOD is pumping today")).toBe(false);
  });

  it("does not flag a cashtag next to a decimal price", () => {
    expect(bodyContainsLink("$HOOD up 12.5% in the last hour")).toBe(false);
  });

  it("does not flag an abbreviation like e.g.", () => {
    expect(bodyContainsLink("great tokenomics, e.g. no team allocation")).toBe(false);
  });

  it("does not flag plain community text", () => {
    expect(bodyContainsLink("gm hoodlums, big day ahead for the community")).toBe(false);
  });

  it("does not flag an empty or whitespace body", () => {
    expect(bodyContainsLink("")).toBe(false);
    expect(bodyContainsLink("   ")).toBe(false);
  });
});

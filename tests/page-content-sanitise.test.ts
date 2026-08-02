import { describe, expect, it } from "vitest";
import { sanitiseContentValue } from "@/lib/server/page-content-sanitise";

describe("sanitiseContentValue", () => {
  it("strips HTML tags from text, heading and button_label values", () => {
    const result = sanitiseContentValue("text", "Hello <script>alert(1)</script> world");
    expect(result).toEqual({ ok: true, value: "Hello alert(1) world" });
  });

  it("rejects a non-string value", () => {
    expect(sanitiseContentValue("text", 42)).toEqual({ ok: false, error: "A text value is required." });
    expect(sanitiseContentValue("text", null)).toMatchObject({ ok: false });
  });

  it("rejects an empty value after stripping and trimming", () => {
    expect(sanitiseContentValue("heading", "   <b></b>  ")).toEqual({
      ok: false,
      error: "This field cannot be empty.",
    });
  });

  it("truncates text to 500 characters and labels to 120", () => {
    const longText = "a".repeat(600);
    const textResult = sanitiseContentValue("text", longText);
    expect(textResult.ok && textResult.value.length).toBe(500);

    const longLabel = "b".repeat(200);
    const labelResult = sanitiseContentValue("button_label", longLabel);
    expect(labelResult.ok && labelResult.value.length).toBe(120);
  });

  it("accepts a site-relative link", () => {
    expect(sanitiseContentValue("button_link", "/testnet")).toEqual({ ok: true, value: "/testnet" });
  });

  it("accepts an https:// link", () => {
    const result = sanitiseContentValue("button_link", "https://example.com/path");
    expect(result).toEqual({ ok: true, value: "https://example.com/path" });
  });

  it("rejects a javascript: link", () => {
    expect(sanitiseContentValue("button_link", "javascript:alert(1)")).toMatchObject({ ok: false });
  });

  it("rejects an http:// (non-https) absolute link", () => {
    expect(sanitiseContentValue("button_link", "http://example.com")).toMatchObject({ ok: false });
  });

  it("rejects a protocol-relative link", () => {
    expect(sanitiseContentValue("button_link", "//evil.example.com")).toMatchObject({ ok: false });
  });

  it("only accepts true/false for visibility", () => {
    expect(sanitiseContentValue("visibility", "true")).toEqual({ ok: true, value: "true" });
    expect(sanitiseContentValue("visibility", "FALSE")).toEqual({ ok: true, value: "false" });
    expect(sanitiseContentValue("visibility", "yes")).toMatchObject({ ok: false });
  });
});

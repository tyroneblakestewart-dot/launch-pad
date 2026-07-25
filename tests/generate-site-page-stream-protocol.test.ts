import { describe, expect, it } from "vitest";
import {
  parseGenerateSitePageStreamLine,
  splitNdjsonLines,
} from "@/lib/generate-site-page-stream-protocol";

describe("splitNdjsonLines", () => {
  it("splits complete lines and keeps a trailing partial line as the remainder", () => {
    const { lines, remainder } = splitNdjsonLines('{"a":1}\n{"b":2}\n{"c":');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(remainder).toBe('{"c":');
  });

  it("keeps everything as remainder when there is no newline yet", () => {
    const { lines, remainder } = splitNdjsonLines('{"a":1');
    expect(lines).toEqual([]);
    expect(remainder).toBe('{"a":1');
  });

  it("reassembles a JSON line that arrives split across two chunks", () => {
    const first = splitNdjsonLines('{"type":"progress","stage":"anal');
    expect(first.lines).toEqual([]);
    const second = splitNdjsonLines(`${first.remainder}ysing-artwork"}\n`);
    expect(second.lines).toEqual(['{"type":"progress","stage":"analysing-artwork"}']);
    expect(second.remainder).toBe("");
  });
});

describe("parseGenerateSitePageStreamLine", () => {
  it("parses a progress event", () => {
    expect(parseGenerateSitePageStreamLine('{"type":"progress","stage":"building-page"}')).toEqual({
      type: "progress",
      stage: "building-page",
    });
  });

  it("parses a complete event", () => {
    expect(
      parseGenerateSitePageStreamLine(
        '{"type":"complete","html":"<html></html>","source":"openai","inspirationUsed":true}',
      ),
    ).toEqual({ type: "complete", html: "<html></html>", source: "openai", inspirationUsed: true });
  });

  it("parses an error event", () => {
    expect(
      parseGenerateSitePageStreamLine('{"type":"error","error":"boom","providerError":{"stage":"x"}}'),
    ).toEqual({ type: "error", error: "boom", providerError: { stage: "x" } });
  });

  it("ignores blank lines", () => {
    expect(parseGenerateSitePageStreamLine("")).toBeNull();
    expect(parseGenerateSitePageStreamLine("   ")).toBeNull();
  });

  it("ignores malformed JSON instead of throwing", () => {
    expect(parseGenerateSitePageStreamLine("{not json")).toBeNull();
  });

  it("ignores an unknown progress stage", () => {
    expect(parseGenerateSitePageStreamLine('{"type":"progress","stage":"unknown-stage"}')).toBeNull();
  });

  it("ignores an unrecognised event type", () => {
    expect(parseGenerateSitePageStreamLine('{"type":"ping"}')).toBeNull();
  });
});

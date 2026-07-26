import { describe, expect, it } from "vitest";
import {
  parseGenerateSitePageStreamLine,
  splitNdjsonLines,
} from "@/lib/generate-site-page-stream-protocol";

describe("splitNdjsonLines", () => {
  it("holds back an incomplete trailing line as the remainder", () => {
    const { lines, remainder } = splitNdjsonLines('{"type":"progress","stage":"building-page"}\n{"type":"comp');
    expect(lines).toEqual(['{"type":"progress","stage":"building-page"}']);
    expect(remainder).toBe('{"type":"comp');
  });

  it("completes a line once the rest of it arrives in the next chunk", () => {
    const firstChunk = '{"type":"complete","html":"<html';
    const partial = splitNdjsonLines(firstChunk);
    expect(partial.lines).toEqual([]);
    expect(partial.remainder).toBe(firstChunk);

    const buffer = partial.remainder + '></html>","source":"openai","inspirationUsed":false}\n';
    const { lines, remainder } = splitNdjsonLines(buffer);
    expect(remainder).toBe("");
    expect(lines).toHaveLength(1);
    expect(parseGenerateSitePageStreamLine(lines[0])).toEqual({
      type: "complete",
      html: "<html></html>",
      source: "openai",
      inspirationUsed: false,
    });
  });

  it("ignores blank lines", () => {
    const { lines } = splitNdjsonLines('{"type":"progress","stage":"analysing-artwork"}\n\n');
    expect(lines).toEqual(['{"type":"progress","stage":"analysing-artwork"}']);
  });
});

describe("parseGenerateSitePageStreamLine", () => {
  it("parses a progress event with a known stage", () => {
    expect(parseGenerateSitePageStreamLine('{"type":"progress","stage":"checking-safety"}')).toEqual({
      type: "progress",
      stage: "checking-safety",
    });
  });

  it("rejects a progress event with an unknown stage", () => {
    expect(parseGenerateSitePageStreamLine('{"type":"progress","stage":"unknown-stage"}')).toBeNull();
  });

  it("parses a complete event", () => {
    expect(
      parseGenerateSitePageStreamLine(
        '{"type":"complete","html":"<html></html>","source":"vercel-ai-gateway","inspirationUsed":true}',
      ),
    ).toEqual({
      type: "complete",
      html: "<html></html>",
      source: "vercel-ai-gateway",
      inspirationUsed: true,
    });
  });

  it("parses an error event and carries the provider error through", () => {
    expect(
      parseGenerateSitePageStreamLine('{"type":"error","error":"boom","providerError":{"stage":"x"}}'),
    ).toEqual({ type: "error", error: "boom", providerError: { stage: "x" } });
  });

  it("returns null for malformed JSON", () => {
    expect(parseGenerateSitePageStreamLine("{not json")).toBeNull();
  });

  it("returns null for an unrecognised event type", () => {
    expect(parseGenerateSitePageStreamLine('{"type":"mystery"}')).toBeNull();
  });
});

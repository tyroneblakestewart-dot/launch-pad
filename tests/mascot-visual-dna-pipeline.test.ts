import { describe, expect, it } from "vitest";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import {
  buildMascotVisualDnaRequestBody,
  isValidMascotImageDataUrl,
  parseMascotVisualDnaResponse,
} from "@/lib/server/mascot-visual-dna-pipeline";

function responseWith(payload: unknown): OpenAIResponse {
  return { output: [{ content: [{ type: "output_text", text: JSON.stringify(payload) }] }] };
}

const VALID_DNA = {
  characterDescription: "A green cartoon hoodie-wearing dog mascot with a confident grin.",
  colourPalette: "lime green, dark navy, off-white",
  signatureProps: "a gold chain and sunglasses",
  artStyle: "flat vector meme illustration, bold outlines",
};

describe("isValidMascotImageDataUrl", () => {
  it("re-exports the same validator used by generate-site-style", () => {
    expect(isValidMascotImageDataUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isValidMascotImageDataUrl("not a data url")).toBe(false);
  });
});

describe("buildMascotVisualDnaRequestBody", () => {
  it("includes the project identity and the uploaded image as an input_image block", () => {
    const body = buildMascotVisualDnaRequestBody(
      { name: "Test Coin", ticker: "TEST" },
      "data:image/png;base64,AAAA",
      "gpt-5-mini",
    );
    expect(body.model).toBe("gpt-5-mini");
    const userContent = body.input[1]?.content ?? [];
    expect(userContent.some((item) => item.type === "input_image" && item.image_url === "data:image/png;base64,AAAA")).toBe(true);
    expect(body.text.format.strict).toBe(true);
  });

  it("sets minimal reasoning effort and a raised output budget so hidden reasoning cannot truncate the JSON (issue #346)", () => {
    const body = buildMascotVisualDnaRequestBody(
      { name: "Test Coin", ticker: "TEST" },
      "data:image/png;base64,AAAA",
      "gpt-5-mini",
    );
    expect(body.reasoning).toEqual({ effort: "minimal" });
    expect(body.max_output_tokens).toBe(1_200);
  });
});

describe("parseMascotVisualDnaResponse", () => {
  it("parses a valid mascot visual DNA object", () => {
    expect(parseMascotVisualDnaResponse(responseWith(VALID_DNA))).toEqual(VALID_DNA);
  });

  it("returns null when a required field is missing", () => {
    const { artStyle: _omit, ...incomplete } = VALID_DNA;
    void _omit;
    expect(parseMascotVisualDnaResponse(responseWith(incomplete))).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const response: OpenAIResponse = { output: [{ content: [{ type: "output_text", text: "not json" }] }] };
    expect(parseMascotVisualDnaResponse(response)).toBeNull();
  });
});

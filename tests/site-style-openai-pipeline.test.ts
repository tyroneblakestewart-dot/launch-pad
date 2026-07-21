import { describe, expect, it } from "vitest";
import {
  buildFinalSiteStyleRequestBody,
  buildInspirationInspectionRequestBody,
  extractVerifiedInspirationAnalysis,
} from "@/lib/site-style-openai-pipeline";
import { normaliseGenerateSiteStyleRequest } from "@/lib/server/generate-site-style";

const VALID_IMAGE = "data:image/png;base64,aGVsbG8=";
const INSPIRATION_URL = "https://example.com/meme-launch";

function input() {
  return normaliseGenerateSiteStyleRequest({
    name: "Meme",
    ticker: "MEME",
    description: "A meme project with enough story to generate a website.",
    imageDataUrl: VALID_IMAGE,
    inspirationUrl: INSPIRATION_URL,
  });
}

describe("two-stage OpenAI site-style pipeline", () => {
  it("builds a dedicated domain-restricted inspection request without structured output", () => {
    const body = buildInspirationInspectionRequestBody(input(), "test-model");

    expect(body).not.toBeNull();
    expect(body).toMatchObject({
      model: "test-model",
      store: false,
      tool_choice: "required",
      tools: [
        {
          type: "web_search",
          search_context_size: "high",
          filters: { allowed_domains: ["example.com"] },
        },
      ],
    });
    expect(body).not.toHaveProperty("text.format");
    expect(body?.input[1].content[0].text).toContain(INSPIRATION_URL);
  });

  it("accepts a design brief only after a completed search used the requested domain", () => {
    const analysis = extractVerifiedInspirationAnalysis(
      {
        output: [
          {
            type: "web_search_call",
            status: "completed",
            action: {
              sources: [{ type: "url", url: "https://example.com/meme-launch" }],
            },
          },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "Typography is oversized and playful. The hero uses a centred image, quick motion, short sections and loud conversational copy.",
              },
            ],
          },
        ],
      },
      "example.com",
    );

    expect(analysis).toContain("Typography is oversized and playful");
    expect(
      extractVerifiedInspirationAnalysis(
        {
          output: [
            {
              type: "web_search_call",
              status: "completed",
              action: { sources: [{ type: "url", url: "https://other.example/page" }] },
            },
            {
              content: [
                {
                  type: "output_text",
                  text: "This text is deliberately long enough but came from the wrong domain and must not count.",
                },
              ],
            },
          ],
        },
        "example.com",
      ),
    ).toBeNull();
  });

  it("feeds the verified brief into a separate strict artwork request with no web tool", () => {
    const brief =
      "Use oversized playful type, a centred framed hero, gentle bounce motion, compact sections and witty conversational copy.";
    const body = buildFinalSiteStyleRequestBody(input(), "test-model", brief) as {
      tools?: unknown;
      tool_choice?: unknown;
      input: Array<{ content: Array<{ type: string; text?: string }> }>;
      text: {
        format: {
          schema: {
            properties: {
              roadmap: Record<string, unknown>;
            };
          };
        };
      };
    };

    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.input[0].content[0].text).toContain("VERIFIED INSPIRATION DESIGN BRIEF");
    expect(body.input[0].content[0].text).not.toContain(
      "MUST inspect it with web search before answering",
    );
    expect(body.input[1].content[0].text).toContain(brief);
    expect(body.input[1].content[0].text).not.toContain(
      "No inspiration website was supplied",
    );
    expect(body.text.format.schema.properties.roadmap).not.toHaveProperty("minItems");
    expect(body.text.format.schema.properties.roadmap).not.toHaveProperty("maxItems");
  });
});

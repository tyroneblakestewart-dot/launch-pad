import { describe, expect, it } from "vitest";
import {
  buildArtworkIdentityRequestBody,
  buildFinalSiteStyleRequestBody,
  buildInspirationInspectionRequestBody,
  extractVerifiedInspirationAnalysis,
  getFusionBriefIds,
  parseArtworkIdentityResponse,
  parseCollaborativeSiteStyleResponse,
  type ArtworkIdentity,
} from "@/lib/site-style-openai-pipeline";
import { normaliseGenerateSiteStyleRequest } from "@/lib/server/generate-site-style";
import { VALID_STYLE } from "./site-style-fixture";

const VALID_IMAGE = "data:image/png;base64,aGVsbG8=";
const INSPIRATION_URL = "https://example.com/meme-launch";
const INSPIRATION_BRIEF =
  "Use oversized editorial type, an asymmetrical split hero, slow floating motion, spacious section pacing and short confident copy.";
const ARTWORK_IDENTITY: ArtworkIdentity = {
  dominantColours: "Forest green #14371F, hood green #2E7D3F, gold #E8C435, off-white and near-black.",
  memeEnergy: "Rebellious street-heist energy with confident, mischievous and community-led momentum.",
  subjectAndIcons: "A hooded crew leader, gold jewellery, green arrows, code rain and a duffel bag.",
  visibleText: "HOODLUMS and small character-role labels are visible.",
  typographyPersonality: "Heavy urban display lettering with sharp terminal-style supporting copy.",
  copyVoice: "Confident, funny, degen and rebellious without making financial promises.",
  nonNegotiables: "Keep the dark code atmosphere, green crew identity, gold accents and central character recognisable.",
};

function input() {
  return normaliseGenerateSiteStyleRequest({
    name: "Meme",
    ticker: "MEME",
    description: "A meme project with enough story to generate a website.",
    imageDataUrl: VALID_IMAGE,
    inspirationUrl: INSPIRATION_URL,
  });
}

describe("verified artwork and inspiration collaboration", () => {
  it("builds a strict high-detail artwork identity request", () => {
    const body = buildArtworkIdentityRequestBody(input(), "test-model");

    expect(body).toMatchObject({
      model: "test-model",
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "artwork_identity",
          strict: true,
        },
      },
    });
    expect(body.input[1].content[1]).toEqual({
      type: "input_image",
      image_url: VALID_IMAGE,
      detail: "high",
    });
    expect(body.input[0].content[0].text).toContain("visual identity that must survive");
  });

  it("parses only complete artwork identity analysis", () => {
    expect(
      parseArtworkIdentityResponse({
        output: [
          {
            content: [
              { type: "output_text", text: JSON.stringify(ARTWORK_IDENTITY) },
            ],
          },
        ],
      }),
    ).toEqual(ARTWORK_IDENTITY);

    expect(
      parseArtworkIdentityResponse({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ ...ARTWORK_IDENTITY, copyVoice: "short" }),
              },
            ],
          },
        ],
      }),
    ).toBeNull();
  });

  it("builds a dedicated domain-restricted presentation inspection", () => {
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
    expect(body?.input[0].content[0].text).toContain("presentation brief");
    expect(body?.input[1].content[0].text).toContain(INSPIRATION_URL);
  });

  it("accepts an inspiration brief only after the requested domain was searched", () => {
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
            content: [{ type: "output_text", text: INSPIRATION_BRIEF }],
          },
        ],
      },
      "example.com",
    );

    expect(analysis).toBe(INSPIRATION_BRIEF);
    expect(
      extractVerifiedInspirationAnalysis(
        {
          output: [
            {
              type: "web_search_call",
              status: "completed",
              action: { sources: [{ type: "url", url: "https://other.example/page" }] },
            },
            { content: [{ type: "output_text", text: INSPIRATION_BRIEF }] },
          ],
        },
        "example.com",
      ),
    ).toBeNull();
  });

  it("forces both verified briefs and evidence IDs into the final design request", () => {
    const ids = getFusionBriefIds(ARTWORK_IDENTITY, INSPIRATION_BRIEF);
    const body = buildFinalSiteStyleRequestBody(
      input(),
      "test-model",
      INSPIRATION_BRIEF,
      ARTWORK_IDENTITY,
    ) as {
      tools?: unknown;
      tool_choice?: unknown;
      max_output_tokens: number;
      input: Array<{ content: Array<{ type: string; text?: string }> }>;
      text: {
        format: {
          schema: {
            properties: Record<string, unknown>;
            required: string[];
          };
        };
      };
    };

    const prompt = body.input[1].content[0].text || "";
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.max_output_tokens).toBe(2_200);
    expect(body.input[0].content[0].text).toContain("MUST fuse both briefs");
    expect(prompt).toContain(ids.artworkBriefId);
    expect(prompt).toContain(ids.inspirationBriefId);
    expect(prompt).toContain(ARTWORK_IDENTITY.dominantColours);
    expect(prompt).toContain(INSPIRATION_BRIEF);
    expect(prompt).toContain("Artwork controls the palette");
    expect(prompt).toContain("Inspiration controls the layout rhythm");
    expect(body.text.format.schema.required).toContain("fusionEvidence");
    expect(body.text.format.schema.properties).toHaveProperty("fusionEvidence");
  });

  it("changes the final collaboration request when either source changes", () => {
    const first = JSON.stringify(
      buildFinalSiteStyleRequestBody(input(), "test-model", INSPIRATION_BRIEF, ARTWORK_IDENTITY),
    );
    const changedArtwork = JSON.stringify(
      buildFinalSiteStyleRequestBody(input(), "test-model", INSPIRATION_BRIEF, {
        ...ARTWORK_IDENTITY,
        memeEnergy: "Wholesome, sleepy and deliberately low-energy cat meme humour.",
      }),
    );
    const changedInspiration = JSON.stringify(
      buildFinalSiteStyleRequestBody(
        input(),
        "test-model",
        "Use compact pixel typography, a centred poster hero, glitch movement and dense arcade-like sections.",
        ARTWORK_IDENTITY,
      ),
    );

    expect(changedArtwork).not.toBe(first);
    expect(changedInspiration).not.toBe(first);
  });

  it("returns a style only when collaboration evidence echoes both brief IDs", () => {
    const ids = getFusionBriefIds(ARTWORK_IDENTITY, INSPIRATION_BRIEF);
    const validPayload = {
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                ...VALID_STYLE,
                fusionEvidence: {
                  ...ids,
                  artworkInfluence:
                    "The palette, street-heist character treatment and rebellious copy voice come from the artwork.",
                  inspirationInfluence:
                    "The split hero, editorial scale, floating movement and spacious pacing come from the website.",
                  collaborationDecision:
                    "The inspiration structure was recoloured, rewritten and reshaped around the artwork identity so both sources feel native to one design.",
                },
              }),
            },
          ],
        },
      ],
    };

    expect(parseCollaborativeSiteStyleResponse(validPayload, ids)).toEqual(VALID_STYLE);
    expect(
      parseCollaborativeSiteStyleResponse(validPayload, {
        ...ids,
        inspirationBriefId: "url-00000000",
      }),
    ).toBeNull();
  });
});

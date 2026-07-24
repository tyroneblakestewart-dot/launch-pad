import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-page/route";
import {
  VERCEL_AI_GATEWAY_RESPONSES_URL,
  VERCEL_OIDC_HEADER,
} from "@/lib/server/ai-responses-runtime";

const ARTWORK = {
  dominantColours: "Powder blue, charcoal black, steel grey, white and restrained transit red accents.",
  memeEnergy: "Curious London journey energy with a playful child-led sense of movement and discovery.",
  subjectAndIcons: "A child studying a Tube map while standing on a scooter, with route lines and station details.",
  visibleText: "Tube map and small London transport labels are visible.",
  typographyPersonality: "Friendly rounded transport signage with clear bold headings rather than cyber display type.",
  copyVoice: "Warm, adventurous, direct and optimistic, like a city journey shared with a community.",
  nonNegotiables: "Keep the child, scooter and route-map story central and avoid hacker or terminal imagery.",
};

function outputText(value: unknown) {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(value) }],
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("POST /api/generate-site-page Vercel runtime authentication", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reaches Vercel AI Gateway for shared analysis and all five pages using the function OIDC header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(outputText({ invalid: true }))
      .mockResolvedValueOnce(outputText(ARTWORK));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("https://hoodlums.dev/api/generate-site-page", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [VERCEL_OIDC_HEADER]: "runtime-oidc-token",
        },
        body: JSON.stringify({
          name: "Journey",
          ticker: "RIDE",
          description: "A community token inspired by finding your route through London.",
          imageDataUrl: "data:image/png;base64,aGVsbG8=",
        }),
      }),
    );

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toBe(VERCEL_AI_GATEWAY_RESPONSES_URL);
      const init = call[1] as RequestInit;
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer runtime-oidc-token");
      expect(JSON.parse(String(init.body)).model).toBe("openai/gpt-5-mini");
    }
  });
});

import type { AIResponsesRuntime } from "@/lib/server/ai-responses-runtime";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";

export type MascotImageResult =
  | { ok: true; imageDataUrl: string }
  | { ok: false; kind: "unsupported-provider" | "network" | "http" | "invalid" };

type OpenAIImagesResponse = {
  data?: Array<{ b64_json?: string }>;
};

/**
 * Calls OpenAI's image-generation endpoint directly. Only supported when the
 * resolved runtime holds a direct OpenAI key — the Vercel AI Gateway
 * fallback used by resolveAIResponsesRuntime targets the chat-style
 * /v1/responses shape, and its image-generation surface is unverified, so we
 * fail closed with a clear "unsupported-provider" result instead of guessing
 * at an unconfirmed endpoint shape.
 */
export async function requestMascotImage(
  runtime: AIResponsesRuntime,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MascotImageResult> {
  if (runtime.source !== "openai") {
    return { ok: false, kind: "unsupported-provider" };
  }

  const imageModel = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";

  let response: Response;
  try {
    response = await fetchImpl(OPENAI_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: imageModel,
        prompt,
        size: "1024x1024",
        n: 1,
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    console.error(
      "Mascot image generation request failed before receiving a response",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, kind: "network" };
  }

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    console.error("Mascot image generation request failed", response.status, message.slice(0, 500));
    return { ok: false, kind: "http" };
  }

  try {
    const payload = (await response.json()) as OpenAIImagesResponse;
    const b64 = payload.data?.[0]?.b64_json;
    if (!b64 || typeof b64 !== "string") return { ok: false, kind: "invalid" };
    return { ok: true, imageDataUrl: `data:image/png;base64,${b64}` };
  } catch {
    return { ok: false, kind: "invalid" };
  }
}

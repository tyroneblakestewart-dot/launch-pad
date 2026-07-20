import { NextResponse } from "next/server";
import {
  buildOpenAIStyleRequest,
  normalizeGenerateSiteStyleInput,
  parseOpenAIStyle,
  type OpenAIResponse,
} from "@/lib/server/generate-site-style";

export const runtime = "nodejs";

const AI_NOT_CONFIGURED =
  "AI style generation is not configured. The browser artwork matcher will be used.";
const AI_UNAVAILABLE =
  "AI analysis was unavailable. The browser artwork matcher will be used.";
const AI_INVALID =
  "AI returned an invalid design. The browser artwork matcher will be used.";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: AI_NOT_CONFIGURED }, { status: 503 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const validation = normalizeGenerateSiteStyleInput(rawBody);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildOpenAIStyleRequest(
          validation.value,
          process.env.OPENAI_VISION_MODEL || "gpt-5-mini",
        ),
      ),
    });
  } catch (error) {
    console.error(
      "OpenAI site-style request failed before receiving a response",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: AI_UNAVAILABLE }, { status: 502 });
  }

  if (!response.ok) {
    let message = "";
    try {
      message = await response.text();
    } catch {
      // The upstream status is sufficient when its error body cannot be read.
    }
    console.error("OpenAI site-style request failed", response.status, message.slice(0, 500));
    return NextResponse.json({ error: AI_UNAVAILABLE }, { status: 502 });
  }

  let payload: OpenAIResponse;
  try {
    payload = (await response.json()) as OpenAIResponse;
  } catch {
    return NextResponse.json({ error: AI_INVALID }, { status: 502 });
  }

  const style = parseOpenAIStyle(payload);
  if (!style) {
    return NextResponse.json({ error: AI_INVALID }, { status: 502 });
  }

  return NextResponse.json({ style: { ...style, source: "openai" } });
}

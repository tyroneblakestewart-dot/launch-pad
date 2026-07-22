import { NextResponse } from "next/server";
import { resolveAIResponsesRuntime } from "@/lib/server/ai-responses-runtime";

export const runtime = "nodejs";

export async function GET() {
  const ai = resolveAIResponsesRuntime();
  const body = ai
    ? {
        ready: true,
        provider: ai.source,
        model: ai.model,
      }
    : {
        ready: false,
        provider: null,
        model: null,
      };

  return NextResponse.json(body, {
    status: ai ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

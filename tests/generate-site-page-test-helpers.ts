import type { GenerateSitePageStreamEvent } from "@/lib/generate-site-page-stream-protocol";

export async function readNdjsonEvents(response: Response): Promise<GenerateSitePageStreamEvent[]> {
  if (!response.body) return [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: GenerateSitePageStreamEvent[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (trimmed) events.push(JSON.parse(trimmed) as GenerateSitePageStreamEvent);
    }
  }
  const trimmed = buffer.trim();
  if (trimmed) events.push(JSON.parse(trimmed) as GenerateSitePageStreamEvent);
  return events;
}

/** Builds a mocked provider `Response` streaming the given raw SSE text chunks. */
export function sseResponse(chunks: string[], init: ResponseInit = { status: 200 }): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, init);
}

/** A single complete SSE event block ("data: ...\n\n") for a Responses API event payload. */
export function sseEventChunk(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

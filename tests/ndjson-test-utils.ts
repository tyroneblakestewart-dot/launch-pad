import {
  parseGenerateSitePageStreamLine,
  type GenerateSitePageStreamEvent,
} from "@/lib/generate-site-page-stream-protocol";

export async function collectStreamEvents(response: Response): Promise<GenerateSitePageStreamEvent[]> {
  const events: GenerateSitePageStreamEvent[] = [];
  if (!response.body) return events;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseGenerateSitePageStreamLine(line);
        if (event) events.push(event);
      }
    }
    if (done) {
      buffer += decoder.decode();
      const event = parseGenerateSitePageStreamLine(buffer);
      if (event) events.push(event);
      break;
    }
  }
  return events;
}

export function findEvent<T extends GenerateSitePageStreamEvent["type"]>(
  events: GenerateSitePageStreamEvent[],
  type: T,
): Extract<GenerateSitePageStreamEvent, { type: T }> | undefined {
  return events.find((event) => event.type === type) as
    | Extract<GenerateSitePageStreamEvent, { type: T }>
    | undefined;
}

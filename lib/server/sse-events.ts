// Minimal Server-Sent-Events block parser for the OpenAI Responses streaming API.
// Events are separated by a blank line; a block may carry an `event:` line and
// one or more `data:` lines. Chunk boundaries from the network never align with
// event boundaries, so callers accumulate `remainder` and feed it back in with
// the next chunk.

export type SseEvent = {
  event: string | null;
  data: string;
};

export type SseExtractionResult = {
  events: SseEvent[];
  remainder: string;
};

function parseBlock(block: string): SseEvent | null {
  let event: string | null = null;
  const dataLines: string[] = [];

  for (const rawLine of block.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

export function extractSseEvents(buffered: string): SseExtractionResult {
  const normalised = buffered.replace(/\r\n/g, "\n");
  const blocks = normalised.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events = blocks
    .map(parseBlock)
    .filter((event): event is SseEvent => event !== null);
  return { events, remainder };
}

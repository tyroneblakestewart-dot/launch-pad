// Minimal Server-Sent-Events block parser for consuming a provider's
// `stream: true` Responses API body. Only the `data:` field is needed here;
// `event:`/`id:`/`retry:` fields and `:`-prefixed comments are ignored.

export type SseParsedEvent =
  | { type: "done" }
  | { type: "data"; json: unknown }
  | { type: "raw"; data: string };

function parseBlock(block: string): SseParsedEvent | null {
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith(":")) continue;
    if (!line.startsWith("data:")) continue;
    dataLines.push(line.length > 5 && line[5] === " " ? line.slice(6) : line.slice(5));
  }
  if (dataLines.length === 0) return null;

  const data = dataLines.join("\n");
  if (data === "[DONE]") return { type: "done" };
  try {
    return { type: "data", json: JSON.parse(data) };
  } catch {
    return { type: "raw", data };
  }
}

/**
 * Reassembles SSE `\n\n`-delimited blocks across arbitrary chunk boundaries.
 * Call `push` for every decoded chunk, and `flush` once after the underlying
 * stream ends to parse any final block that never received a trailing blank
 * line (a network close mid-block should not silently drop that event).
 */
export class SseEventParser {
  private buffer = "";

  push(chunk: string): SseParsedEvent[] {
    if (!chunk) return [];
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, "\n");

    const events: SseParsedEvent[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const event = parseBlock(this.buffer.slice(0, boundary));
      if (event) events.push(event);
      this.buffer = this.buffer.slice(boundary + 2);
      boundary = this.buffer.indexOf("\n\n");
    }
    return events;
  }

  flush(): SseParsedEvent[] {
    const remaining = this.buffer;
    this.buffer = "";
    if (!remaining.trim()) return [];
    const event = parseBlock(remaining);
    return event ? [event] : [];
  }
}

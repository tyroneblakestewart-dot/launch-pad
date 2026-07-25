import { describe, expect, it } from "vitest";
import { SseEventParser } from "@/lib/server/sse-events";

describe("SseEventParser", () => {
  it("parses a single data block delivered as one chunk", () => {
    const parser = new SseEventParser();
    const events = parser.push('data: {"type":"response.completed","response":{"a":1}}\n\n');
    expect(events).toEqual([{ type: "data", json: { type: "response.completed", response: { a: 1 } } }]);
    expect(parser.flush()).toEqual([]);
  });

  it("reassembles an event split across arbitrary chunk boundaries, including mid-field splits", () => {
    const full = 'data: {"type":"response.output_text.delta","delta":"hello"}\n\n';
    // Split at every offset to exercise every possible chunk boundary.
    for (let cut = 1; cut < full.length; cut += 1) {
      const localParser = new SseEventParser();
      const first = localParser.push(full.slice(0, cut));
      const second = localParser.push(full.slice(cut));
      expect([...first, ...second]).toEqual([
        { type: "data", json: { type: "response.output_text.delta", delta: "hello" } },
      ]);
    }
  });

  it("handles CRLF line endings", () => {
    const parser = new SseEventParser();
    const events = parser.push('data: {"type":"response.completed","response":{}}\r\n\r\n');
    expect(events).toEqual([{ type: "data", json: { type: "response.completed", response: {} } }]);
  });

  it("joins multiple data: lines within one block with newlines", () => {
    const parser = new SseEventParser();
    const events = parser.push('data: {"type":"response.output_text.delta",\ndata: "delta":"x"}\n\n');
    expect(events).toEqual([{ type: "data", json: { type: "response.output_text.delta", delta: "x" } }]);
  });

  it("ignores comment lines and blank keepalive blocks", () => {
    const parser = new SseEventParser();
    const events = parser.push(': keepalive\n\ndata: {"type":"response.completed","response":{}}\n\n');
    expect(events).toEqual([{ type: "data", json: { type: "response.completed", response: {} } }]);
  });

  it("emits a done event for the [DONE] sentinel", () => {
    const parser = new SseEventParser();
    const events = parser.push("data: [DONE]\n\n");
    expect(events).toEqual([{ type: "done" }]);
  });

  it("returns a raw event for a data payload that is not valid JSON", () => {
    const parser = new SseEventParser();
    const events = parser.push("data: not-json\n\n");
    expect(events).toEqual([{ type: "raw", data: "not-json" }]);
  });

  it("parses several events queued in a single chunk", () => {
    const parser = new SseEventParser();
    const events = parser.push(
      'data: {"type":"response.output_text.delta","delta":"a"}\n\n' +
        'data: {"type":"response.output_text.delta","delta":"b"}\n\n',
    );
    expect(events).toEqual([
      { type: "data", json: { type: "response.output_text.delta", delta: "a" } },
      { type: "data", json: { type: "response.output_text.delta", delta: "b" } },
    ]);
  });

  it("flush() parses a final block that never received a trailing blank line", () => {
    const parser = new SseEventParser();
    const events = parser.push('data: {"type":"response.output_text.delta","delta":"partial"}\n\n');
    expect(events).toHaveLength(1);
    // Network closes mid-block, with no trailing "\n\n" after the last event.
    const unterminated = parser.push('data: {"type":"response.completed","response":{"done":true}}');
    expect(unterminated).toEqual([]);
    expect(parser.flush()).toEqual([
      { type: "data", json: { type: "response.completed", response: { done: true } } },
    ]);
    // flush() is idempotent once drained.
    expect(parser.flush()).toEqual([]);
  });

  it("flush() ignores trailing whitespace-only buffers", () => {
    const parser = new SseEventParser();
    parser.push("data: {}\n\n   \n");
    expect(parser.flush()).toEqual([]);
  });
});

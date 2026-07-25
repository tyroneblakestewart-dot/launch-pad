import { describe, expect, it } from "vitest";
import { extractSseEvents } from "@/lib/server/sse-events";

describe("extractSseEvents", () => {
  it("parses a single complete event with an event line and a data line", () => {
    const { events, remainder } = extractSseEvents(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n',
    );
    expect(events).toEqual([
      { event: "response.output_text.delta", data: '{"type":"response.output_text.delta","delta":"hi"}' },
    ]);
    expect(remainder).toBe("");
  });

  it("parses multiple events delivered in one chunk", () => {
    const chunk =
      'event: response.output_text.delta\ndata: {"delta":"a"}\n\n' +
      'event: response.output_text.delta\ndata: {"delta":"b"}\n\n';
    const { events, remainder } = extractSseEvents(chunk);
    expect(events).toHaveLength(2);
    expect(events[0].data).toBe('{"delta":"a"}');
    expect(events[1].data).toBe('{"delta":"b"}');
    expect(remainder).toBe("");
  });

  it("holds back an incomplete trailing event as remainder", () => {
    const { events, remainder } = extractSseEvents(
      'event: response.output_text.delta\ndata: {"delta":"a"}\n\nevent: response.completed\ndata: {"typ',
    );
    expect(events).toHaveLength(1);
    expect(remainder).toBe('event: response.completed\ndata: {"typ');
  });

  it("reassembles an event whose data line arrives split across two chunks", () => {
    const first = extractSseEvents('event: response.output_text.delta\ndata: {"delta":"hel');
    expect(first.events).toHaveLength(0);
    expect(first.remainder).toBe('event: response.output_text.delta\ndata: {"delta":"hel');

    const second = extractSseEvents(`${first.remainder}lo"}\n\n`);
    expect(second.events).toEqual([
      { event: "response.output_text.delta", data: '{"delta":"hello"}' },
    ]);
    expect(second.remainder).toBe("");
  });

  it("reassembles an event whose terminating blank line arrives in a later chunk", () => {
    const first = extractSseEvents('event: response.completed\ndata: {"type":"response.completed"}\n');
    expect(first.events).toHaveLength(0);

    const second = extractSseEvents(`${first.remainder}\n`);
    expect(second.events).toEqual([
      { event: "response.completed", data: '{"type":"response.completed"}' },
    ]);
    expect(second.remainder).toBe("");
  });

  it("handles CRLF line endings from some proxies", () => {
    const { events } = extractSseEvents(
      'event: response.output_text.delta\r\ndata: {"delta":"hi"}\r\n\r\n',
    );
    expect(events).toEqual([
      { event: "response.output_text.delta", data: '{"delta":"hi"}' },
    ]);
  });

  it("joins multiple data lines within one event per the SSE spec", () => {
    const { events } = extractSseEvents("data: line-one\ndata: line-two\n\n");
    expect(events).toEqual([{ event: null, data: "line-one\nline-two" }]);
  });

  it("ignores comment lines and blocks with no data", () => {
    const { events } = extractSseEvents(": keep-alive\n\nevent: response.completed\n\n");
    expect(events).toEqual([]);
  });

  it("passes through a literal [DONE] sentinel as event data", () => {
    const { events } = extractSseEvents("data: [DONE]\n\n");
    expect(events).toEqual([{ event: null, data: "[DONE]" }]);
  });
});

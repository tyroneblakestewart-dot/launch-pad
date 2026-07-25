export type SseTestEvent = { event?: string; data: unknown };

export function sseEventText(event: SseTestEvent): string {
  const dataLine = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
  const eventLine = event.event ? `event: ${event.event}\n` : "";
  return `${eventLine}data: ${dataLine}\n\n`;
}

export function sseChunkedStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

export function sseStreamResponse(events: SseTestEvent[]): Response {
  return sseChunkedStreamResponse([events.map(sseEventText).join("")]);
}

export function outputTextDeltaEvent(delta: string): SseTestEvent {
  return { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta } };
}

export function outputTextDoneEvent(text: string): SseTestEvent {
  return { event: "response.output_text.done", data: { type: "response.output_text.done", text } };
}

export function responseCompletedEvent(payload: unknown): SseTestEvent {
  return { event: "response.completed", data: { type: "response.completed", response: payload } };
}

export function responseIncompleteEvent(reason: string): SseTestEvent {
  return {
    event: "response.incomplete",
    data: {
      type: "response.incomplete",
      response: { status: "incomplete", incomplete_details: { reason } },
    },
  };
}

export function responseFailedEvent(message: string): SseTestEvent {
  return {
    event: "response.failed",
    data: { type: "response.failed", response: { error: { message } } },
  };
}

export function generatedPagePayload(value: unknown) {
  return { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] };
}

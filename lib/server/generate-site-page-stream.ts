import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import { sanitiseProviderDetail } from "@/lib/server/sanitise-provider-detail";
import type { AIResponsesRuntime } from "@/lib/server/ai-responses-runtime";

export const MAX_STREAMED_OUTPUT_TEXT_LENGTH = 220_000;

export type StreamedOpenAIRequestFailure = {
  ok: false;
  kind: "network" | "http" | "invalid";
  status?: number;
  detail?: string;
};

export type StreamedOpenAIRequestResult =
  | { ok: true; payload: OpenAIResponse }
  | StreamedOpenAIRequestFailure;

type SseEvent = { event: string | null; data: string };

type OutputTextDoneEvent = { text?: unknown };
type ResponseEnvelopeEvent = { response?: unknown };
type ProtocolErrorEvent = { message?: unknown };

function overCapFailure(): StreamedOpenAIRequestFailure {
  return {
    ok: false,
    kind: "invalid",
    detail: `The provider response exceeded the ${MAX_STREAMED_OUTPUT_TEXT_LENGTH}-character streaming buffer cap.`,
  };
}

function incompleteDetail(response: unknown): string {
  const metadata = response as { incomplete_details?: { reason?: unknown } } | null | undefined;
  const reason = metadata?.incomplete_details?.reason;
  const suffix = typeof reason === "string" && reason.trim() ? ` because ${reason.trim()}` : "";
  return `The full-page generation stream ended incomplete${suffix}.`;
}

function failedDetail(response: unknown): string {
  const failure = response as { error?: { message?: unknown } } | null | undefined;
  const message = failure?.error?.message;
  return typeof message === "string" && message.trim()
    ? sanitiseProviderDetail(message)
    : "The provider reported that full-page generation failed.";
}

// Parses one blank-line-delimited SSE block ("event: ...\ndata: ...") into its
// event name and joined data lines. Handles stray "\r" from CRLF transports.
function parseSseBlock(block: string): SseEvent {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  return { event, data: dataLines.join("\n") };
}

// Streams the Responses API full-page-generation call. Buffers only enough
// output text to enforce MAX_STREAMED_OUTPUT_TEXT_LENGTH and to detect an
// output_text.done event that arrives without prior deltas; the validated
// payload used by callers always comes from the response.completed event.
export async function streamGeneratedSitePage(
  ai: AIResponsesRuntime,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<StreamedOpenAIRequestResult> {
  let response: Response;
  try {
    response = await fetch(ai.responsesUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ai.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
  } catch (error) {
    return { ok: false, kind: "network", detail: sanitiseProviderDetail(error) };
  }

  if (!response.ok) {
    const message = sanitiseProviderDetail(await response.text().catch(() => ""));
    return { ok: false, kind: "http", status: response.status, detail: message };
  }
  if (!response.body) {
    return { ok: false, kind: "invalid", detail: "The provider stream response had no body." };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let textLength = 0;
  let deltaReceived = false;

  function handleBlock(rawBlock: string): StreamedOpenAIRequestResult | null {
    const block = rawBlock.trim();
    if (!block) return null;

    const { event, data } = parseSseBlock(block);
    if (!data) return null;
    if (data === "[DONE]") {
      return {
        ok: false,
        kind: "invalid",
        detail: "The provider stream ended before returning a completed response.",
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }

    const type = event || (parsed as { type?: unknown }).type;
    switch (type) {
      case "response.output_text.delta": {
        const delta = (parsed as { delta?: unknown }).delta;
        deltaReceived = true;
        textLength += typeof delta === "string" ? delta.length : 0;
        return textLength > MAX_STREAMED_OUTPUT_TEXT_LENGTH ? overCapFailure() : null;
      }
      case "response.output_text.done": {
        // If deltas already arrived, the buffer length is already accounted
        // for and the done event's text must not be appended again. Only use
        // the done event's own text for cap/progress accounting when no
        // deltas were received for this output item.
        if (!deltaReceived) {
          const text = (parsed as OutputTextDoneEvent).text;
          textLength = typeof text === "string" ? text.length : textLength;
        }
        return textLength > MAX_STREAMED_OUTPUT_TEXT_LENGTH ? overCapFailure() : null;
      }
      case "response.completed": {
        const finalResponse = (parsed as ResponseEnvelopeEvent).response;
        if (!finalResponse || typeof finalResponse !== "object") {
          return {
            ok: false,
            kind: "invalid",
            detail: "The provider completed event was missing the response payload.",
          };
        }
        return { ok: true, payload: finalResponse as OpenAIResponse };
      }
      case "response.incomplete": {
        const finalResponse = (parsed as ResponseEnvelopeEvent).response;
        return { ok: false, kind: "invalid", detail: incompleteDetail(finalResponse) };
      }
      case "response.failed": {
        const finalResponse = (parsed as ResponseEnvelopeEvent).response;
        return { ok: false, kind: "invalid", detail: failedDetail(finalResponse) };
      }
      case "error": {
        const message = (parsed as ProtocolErrorEvent).message;
        return {
          ok: false,
          kind: "invalid",
          detail:
            typeof message === "string" && message.trim()
              ? sanitiseProviderDetail(message)
              : "The provider returned a stream error.",
        };
      }
      default:
        return null;
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        let separatorIndex = buffer.indexOf("\n\n");
        while (separatorIndex !== -1) {
          const block = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const result = handleBlock(block);
          if (result) return result;
          separatorIndex = buffer.indexOf("\n\n");
        }
      }

      if (done) {
        // Flush any buffered multi-byte tail, then defensively parse one
        // final unterminated block in case a proxy dropped the trailing
        // blank line that would normally end the last SSE event.
        buffer += decoder.decode();
        const result = handleBlock(buffer);
        if (result) return result;
        break;
      }
    }
  } catch (error) {
    return { ok: false, kind: "network", detail: sanitiseProviderDetail(error) };
  } finally {
    reader.releaseLock();
  }

  return {
    ok: false,
    kind: "invalid",
    detail: "The provider stream ended without a completed response.",
  };
}

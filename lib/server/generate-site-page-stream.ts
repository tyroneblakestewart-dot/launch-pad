import { sanitiseProviderDetail } from "@/lib/server/sanitise-provider-detail";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import type { AIResponsesRuntime } from "@/lib/server/ai-responses-runtime";

// The provider streams the same strict-JSON structured output as a run of
// response.output_text.delta events. This caps how much of that text we hold
// in memory before giving up on a runaway or malformed generation.
export const STREAMED_OUTPUT_TEXT_BUFFER_LIMIT = 220_000;

export type StreamedFullPageFailureKind = "network" | "http" | "invalid" | "incomplete" | "failed";

export type StreamedFullPageOutcome =
  | { ok: true; payload: OpenAIResponse }
  | { ok: false; kind: StreamedFullPageFailureKind; status?: number; detail?: string };

type SseEventPayload = {
  type?: unknown;
  delta?: unknown;
  text?: unknown;
  response?: unknown;
  message?: unknown;
};

/**
 * Splits a growing SSE text buffer into complete "\n\n"-delimited event
 * blocks plus the incomplete trailing remainder, so callers can feed it
 * fresh decoded chunks without losing an event split across chunk
 * boundaries (or a multi-byte UTF-8 character split across reads, handled by
 * the caller decoding with `{ stream: true }`).
 */
export function splitCompleteSseEvents(buffer: string): { events: string[]; remainder: string } {
  const normalised = buffer.replace(/\r\n/g, "\n");
  const parts = normalised.split("\n\n");
  const remainder = parts.pop() ?? "";
  return { events: parts.filter((part) => part.trim().length > 0), remainder };
}

export function extractSseEventData(block: string): string | null {
  const dataLines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  if (!dataLines.length) return null;
  return dataLines.join("\n");
}

function incompleteReason(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const details = (response as { incomplete_details?: unknown }).incomplete_details;
  if (!details || typeof details !== "object") return undefined;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.trim() ? reason.trim() : undefined;
}

function failedMessage(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const error = (response as { error?: unknown }).error;
  if (!error || typeof error !== "object") return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : undefined;
}

function oversizedFailure(): StreamedFullPageOutcome {
  return {
    ok: false,
    kind: "invalid",
    detail: `The AI response exceeded the ${STREAMED_OUTPUT_TEXT_BUFFER_LIMIT}-character streaming buffer before completing.`,
  };
}

/**
 * Sends the final full-page-generation request with `stream: true` and
 * parses the Responses API SSE stream, buffering only the structured output
 * text (capped) rather than any partial HTML. Resolves once a terminal event
 * (`response.completed`, `response.incomplete`, `response.failed`, a
 * protocol-level `error`, or `[DONE]`) is seen, or the connection ends.
 *
 * Exactly one provider request is made; the caller supplies `signal` (the
 * incoming request's own signal is fine) instead of a total request timeout.
 */
export async function requestStreamedFullPageGeneration(
  ai: AIResponsesRuntime,
  body: Record<string, unknown>,
  signal: AbortSignal,
  onDelta?: () => void,
): Promise<StreamedFullPageOutcome> {
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
    return { ok: false, kind: "invalid", detail: "The provider did not return a streamable response body." };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let structuredTextLength = 0;
  let receivedDelta = false;
  let settled: StreamedFullPageOutcome | null = null;

  const accountText = (value: string, replaceExisting: boolean) => {
    structuredTextLength = replaceExisting ? value.length : structuredTextLength + value.length;
    onDelta?.();
    if (structuredTextLength > STREAMED_OUTPUT_TEXT_BUFFER_LIMIT) {
      settled = oversizedFailure();
    }
  };

  const processBlock = (block: string) => {
    if (settled) return;
    const data = extractSseEventData(block);
    if (data === null) return;

    if (data === "[DONE]") {
      settled = {
        ok: false,
        kind: "invalid",
        detail: "The provider stream ended before the website was completed.",
      };
      return;
    }

    let event: SseEventPayload;
    try {
      event = JSON.parse(data) as SseEventPayload;
    } catch {
      return;
    }

    switch (event.type) {
      case "response.output_text.delta": {
        if (typeof event.delta === "string") {
          receivedDelta = true;
          accountText(event.delta, false);
        }
        break;
      }
      case "response.output_text.done": {
        // Some Responses-compatible providers send only a final text event,
        // while others send deltas followed by the same complete text. Count
        // the done text only when no deltas were received so it is never
        // double-counted or exposed as a second partial document.
        if (!receivedDelta && typeof event.text === "string") {
          accountText(event.text, true);
        }
        break;
      }
      case "response.completed": {
        settled = event.response
          ? { ok: true, payload: event.response as OpenAIResponse }
          : {
              ok: false,
              kind: "invalid",
              detail: "The provider completed event did not include a response payload.",
            };
        break;
      }
      case "response.incomplete": {
        const reason = incompleteReason(event.response);
        settled = {
          ok: false,
          kind: "incomplete",
          detail: sanitiseProviderDetail(
            reason
              ? `The full page generation stream was incomplete because ${reason}.`
              : "The full page generation stream was incomplete.",
          ),
        };
        break;
      }
      case "response.failed": {
        const message = failedMessage(event.response);
        settled = {
          ok: false,
          kind: "failed",
          detail: sanitiseProviderDetail(message || "The full page generation stream failed."),
        };
        break;
      }
      case "error": {
        const message = typeof event.message === "string" ? event.message : "The provider reported a stream error.";
        settled = { ok: false, kind: "invalid", detail: sanitiseProviderDetail(message) };
        break;
      }
      default:
        break;
    }
  };

  const processBuffer = (flushRemainder = false) => {
    const { events, remainder } = splitCompleteSseEvents(buffer);
    buffer = remainder;
    for (const block of events) {
      processBlock(block);
      if (settled) return;
    }
    if (flushRemainder && !settled && buffer.trim()) {
      processBlock(buffer);
      buffer = "";
    }
  };

  try {
    while (!settled) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        processBuffer(true);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      processBuffer();
    }
  } catch (error) {
    if (!settled) settled = { ok: false, kind: "network", detail: sanitiseProviderDetail(error) };
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed; nothing left to clean up.
    }
    try {
      reader.releaseLock();
    } catch {
      // The reader may already have released its lock.
    }
  }

  return (
    settled ?? {
      ok: false,
      kind: "invalid",
      detail: "The provider stream ended before the website was completed.",
    }
  );
}

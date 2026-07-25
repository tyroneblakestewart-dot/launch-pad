export const GENERATE_SITE_PAGE_PROGRESS_STAGES = [
  "analysing-artwork",
  "preparing-design",
  "building-page",
  "checking-safety",
] as const;

export type GenerateSitePageProgressStage = (typeof GENERATE_SITE_PAGE_PROGRESS_STAGES)[number];

export type GenerateSitePageStreamEvent =
  | { type: "progress"; stage: GenerateSitePageProgressStage }
  | { type: "complete"; html: string; source: string; inspirationUsed: boolean }
  | { type: "error"; error: string; providerError?: unknown };

function isProgressStage(value: unknown): value is GenerateSitePageProgressStage {
  return (
    typeof value === "string" &&
    (GENERATE_SITE_PAGE_PROGRESS_STAGES as readonly string[]).includes(value)
  );
}

/**
 * Splits a growing NDJSON text buffer into complete lines plus the incomplete
 * trailing remainder, so callers can feed it fresh decoded chunks and keep
 * re-parsing without losing a line split across chunk boundaries.
 */
export function splitNdjsonLines(buffer: string): { lines: string[]; remainder: string } {
  const parts = buffer.split("\n");
  const remainder = parts.pop() ?? "";
  return { lines: parts.filter((line) => line.trim().length > 0), remainder };
}

export function parseGenerateSitePageStreamLine(line: string): GenerateSitePageStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;

  if (event.type === "progress" && isProgressStage(event.stage)) {
    return { type: "progress", stage: event.stage };
  }
  if (event.type === "complete" && typeof event.html === "string") {
    return {
      type: "complete",
      html: event.html,
      source: typeof event.source === "string" ? event.source : "",
      inspirationUsed: event.inspirationUsed === true,
    };
  }
  if (event.type === "error" && typeof event.error === "string") {
    return { type: "error", error: event.error, providerError: event.providerError };
  }
  return null;
}

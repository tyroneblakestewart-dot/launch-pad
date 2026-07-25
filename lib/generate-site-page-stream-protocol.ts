export type GenerateSitePageStreamStage =
  | "analysing-artwork"
  | "preparing-design"
  | "building-page"
  | "checking-safety";

export type GenerateSitePageProviderError = {
  stage: string;
  provider: string;
  kind: string;
  status: number | null;
  detail: string | null;
};

export type GenerateSitePageStreamEvent =
  | { type: "progress"; stage: GenerateSitePageStreamStage }
  | { type: "complete"; html: string; source: string; inspirationUsed: boolean }
  | { type: "error"; error: string; providerError?: GenerateSitePageProviderError | null };

export const GENERATE_SITE_PAGE_NDJSON_CONTENT_TYPE = "application/x-ndjson";

function isStage(value: unknown): value is GenerateSitePageStreamStage {
  return (
    value === "analysing-artwork" ||
    value === "preparing-design" ||
    value === "building-page" ||
    value === "checking-safety"
  );
}

export function parseGenerateSitePageStreamLine(line: string): GenerateSitePageStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;

  if (value.type === "progress" && isStage(value.stage)) {
    return { type: "progress", stage: value.stage };
  }
  if (value.type === "complete" && typeof value.html === "string" && typeof value.source === "string") {
    return { type: "complete", html: value.html, source: value.source, inspirationUsed: value.inspirationUsed === true };
  }
  if (value.type === "error" && typeof value.error === "string") {
    return {
      type: "error",
      error: value.error,
      providerError: (value.providerError as GenerateSitePageProviderError | null | undefined) ?? null,
    };
  }
  return null;
}

// NDJSON lines can arrive split across chunk boundaries; callers append each
// chunk to a buffer, call this to extract complete lines, and keep the
// returned remainder for the next chunk.
export function splitNdjsonLines(buffer: string): { lines: string[]; remainder: string } {
  const parts = buffer.split("\n");
  const remainder = parts.pop() ?? "";
  return { lines: parts, remainder };
}

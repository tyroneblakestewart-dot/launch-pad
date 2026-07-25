export function sanitiseProviderDetail(value: unknown): string {
  const text = typeof value === "string" ? value : value instanceof Error ? value.message : String(value || "");
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(?:api[_-]?key|token)(["'\s:=]+)[A-Za-z0-9._~+/=-]+/gi, "credential$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

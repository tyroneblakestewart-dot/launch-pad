// Shared client-error text sanitiser (issue #353). Runs both in the browser
// (before a crash report ever leaves the client) and again on the server as
// defense in depth, since a buggy or tampered client can't be trusted to
// have sanitised its own payload. Strips anything resembling a data URL, a
// long base64 blob, or a bearer/JWT-style token, then hard-caps length.

export const CLIENT_ERROR_MESSAGE_MAX_LENGTH = 300;
export const CLIENT_ERROR_STACK_MAX_LENGTH = 2000;

const DATA_URL_PATTERN = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-zA-Z0-9+/=]+/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[a-zA-Z0-9._-]+/gi;
const JWT_PATTERN = /[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g;
const LONG_BASE64_PATTERN = /[a-zA-Z0-9+/]{40,}={0,2}/g;

function redact(text: string): string {
  return text
    .replace(DATA_URL_PATTERN, "[data-url-removed]")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [token-removed]")
    .replace(JWT_PATTERN, "[token-removed]")
    .replace(LONG_BASE64_PATTERN, "[base64-removed]");
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** Sanitises and truncates arbitrary client-error text (message or stack). */
export function sanitiseClientErrorText(raw: string, maxLength: number): string {
  return truncate(redact(raw), maxLength);
}

export function sanitiseClientErrorMessage(raw: string): string {
  return sanitiseClientErrorText(raw, CLIENT_ERROR_MESSAGE_MAX_LENGTH);
}

export function sanitiseClientErrorStack(raw: string): string {
  return sanitiseClientErrorText(raw, CLIENT_ERROR_STACK_MAX_LENGTH);
}

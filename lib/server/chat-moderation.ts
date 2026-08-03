// Shared moderation rules for both Hoodchat features (issue #237).

export const CHAT_MESSAGE_MAX_LENGTH = 280;
export const CHAT_REPORT_HIDE_THRESHOLD = 3;

// Rejects http(s)/www links and bare domain-like tokens (e.g. "example.com")
// so a message can't smuggle a link through by omitting the scheme.
const URL_PATTERN =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|xyz|app|dev|co|gg|me|finance|fi|to|link|club|info)\b)/i;

export function containsUrl(value: string): boolean {
  return URL_PATTERN.test(value);
}

export type ChatMessageValidationResult =
  | { valid: true; body: string }
  | { valid: false; reason: string };

export function validateChatMessageBody(value: unknown): ChatMessageValidationResult {
  if (typeof value !== "string") return { valid: false, reason: "A message body is required." };
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, reason: "A message body is required." };
  if (trimmed.length > CHAT_MESSAGE_MAX_LENGTH) {
    return { valid: false, reason: `Messages must be ${CHAT_MESSAGE_MAX_LENGTH} characters or fewer.` };
  }
  if (containsUrl(trimmed)) return { valid: false, reason: "Links are not allowed in messages." };
  return { valid: true, body: trimmed };
}

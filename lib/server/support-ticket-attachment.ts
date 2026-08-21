import { estimateDataUrlLength, MAX_COMPRESSED_ARTWORK_BYTES } from "@/lib/artwork-compression";

// Validates the single optional screenshot a user may attach at support
// ticket creation (issue #398). Mirrors lib/server/telegram.ts's
// parseArtwork (mime allowlist regex + decoded-byte cap) but is kept as its
// own module scoped to support tickets, and deliberately excludes
// image/svg+xml — the stored value is only ever rendered as
// <img src="data:...">, never interpreted as markup. The client-side
// compressor (components/support-hub.tsx) targets
// MAX_SUPPORT_TICKET_ATTACHMENT_BYTES already, but this validation is the
// authoritative check — the client's resize is never trusted.

const SUPPORT_TICKET_ATTACHMENT_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
// Matches any well-formed data: URL's mime type first, so an unsupported (or malicious, e.g. image/svg+xml) type is reported distinctly from a plain syntax error.
const DATA_URL_PATTERN = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

/** Matches the client-side compressor's target ceiling (lib/artwork-compression.ts) so a properly optimised screenshot always clears validation. */
export const MAX_SUPPORT_TICKET_ATTACHMENT_BYTES = MAX_COMPRESSED_ARTWORK_BYTES;

/** A fast pre-decode length guard sized off the worst-case base64 length of MAX_SUPPORT_TICKET_ATTACHMENT_BYTES, with headroom — same reasoning as generate-site-style.ts's MAX_IMAGE_DATA_URL_LENGTH. */
export const MAX_SUPPORT_TICKET_ATTACHMENT_DATA_URL_LENGTH = Math.ceil(
  estimateDataUrlLength(MAX_SUPPORT_TICKET_ATTACHMENT_BYTES) * 1.05,
);

export type SupportTicketAttachmentValidation =
  | { status: "ok"; dataUrl: string }
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "unsupported_type" }
  | { status: "too_large" };

/** `value` is `undefined`/`null`/`""` for "no attachment" — every other non-string input is rejected as invalid, not silently treated as empty. */
export function validateSupportTicketAttachment(value: unknown): SupportTicketAttachmentValidation {
  if (value === undefined || value === null || value === "") return { status: "empty" };
  if (typeof value !== "string") return { status: "invalid" };

  const trimmed = value.trim();
  if (!trimmed) return { status: "empty" };
  if (trimmed.length > MAX_SUPPORT_TICKET_ATTACHMENT_DATA_URL_LENGTH) return { status: "too_large" };

  const match = DATA_URL_PATTERN.exec(trimmed);
  if (!match) return { status: "invalid" };

  const mimeType = match[1].toLowerCase();
  if (!SUPPORT_TICKET_ATTACHMENT_MIME_TYPES.has(mimeType)) return { status: "unsupported_type" };

  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2], "base64");
  } catch {
    return { status: "invalid" };
  }
  if (bytes.length === 0) return { status: "invalid" };
  if (bytes.length > MAX_SUPPORT_TICKET_ATTACHMENT_BYTES) return { status: "too_large" };

  return { status: "ok", dataUrl: trimmed };
}

/** Plain-English rejection reason for every non-"ok" validation status except "empty" (which is not an error — no attachment was provided). */
export function supportTicketAttachmentErrorMessage(
  status: Exclude<SupportTicketAttachmentValidation["status"], "ok" | "empty">,
): string {
  if (status === "too_large") return "The screenshot is too large.";
  if (status === "unsupported_type") return "That file type isn't supported.";
  return "That screenshot could not be read.";
}

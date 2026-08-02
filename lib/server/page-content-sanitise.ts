import type { PageContentElementType } from "@/lib/page-content-registry";

export type SanitiseContentResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

const TEXT_MAX_LENGTH = 500;
const LABEL_MAX_LENGTH = 120;
const LINK_MAX_LENGTH = 300;

/** Strips any HTML tags and collapses whitespace so no markup can ever reach output. */
function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sanitisePlainText(rawValue: string, maxLength: number): SanitiseContentResult {
  const value = stripTags(rawValue).slice(0, maxLength);
  if (!value) return { ok: false, error: "This field cannot be empty." };
  return { ok: true, value };
}

function sanitiseLink(rawValue: string): SanitiseContentResult {
  const value = stripTags(rawValue).slice(0, LINK_MAX_LENGTH);
  if (!value) return { ok: false, error: "This field cannot be empty." };
  if (value.startsWith("/") && !value.startsWith("//")) {
    return { ok: true, value };
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return { ok: false, error: "Links must be a site-relative path or an https:// URL." };
    }
    return { ok: true, value: url.toString() };
  } catch {
    return { ok: false, error: "Links must be a site-relative path or an https:// URL." };
  }
}

function sanitiseVisibility(rawValue: string): SanitiseContentResult {
  const value = rawValue.trim().toLowerCase();
  if (value !== "true" && value !== "false") {
    return { ok: false, error: "Visibility must be true or false." };
  }
  return { ok: true, value };
}

/**
 * Sanitises a submitted content value by element type before it is ever
 * staged as a draft. Plain text is stripped of any HTML so the CMS cannot be
 * used to inject markup into a public page; links are limited to
 * site-relative paths or https:// URLs.
 */
export function sanitiseContentValue(
  elementType: PageContentElementType,
  rawValue: unknown,
): SanitiseContentResult {
  if (typeof rawValue !== "string") {
    return { ok: false, error: "A text value is required." };
  }

  switch (elementType) {
    case "heading":
      return sanitisePlainText(rawValue, LABEL_MAX_LENGTH);
    case "button_label":
      return sanitisePlainText(rawValue, LABEL_MAX_LENGTH);
    case "text":
      return sanitisePlainText(rawValue, TEXT_MAX_LENGTH);
    case "button_link":
      return sanitiseLink(rawValue);
    case "visibility":
      return sanitiseVisibility(rawValue);
    default:
      return { ok: false, error: "Unknown content type." };
  }
}

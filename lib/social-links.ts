// X/Twitter handles are 1-15 characters of letters, digits and underscores.
const TWITTER_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

// Telegram usernames are 5-32 characters, must start with a letter, and
// contain only letters, digits and underscores.
const TELEGRAM_HANDLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

// Reserved X/Twitter path segments that are platform chrome, not profile
// handles (e.g. https://x.com/i/flow/login). A real user could technically
// be named one of these, but on a public page that renders a confident
// branded button, wrongly linking to platform chrome instead of failing
// closed to plain text is the worse outcome — so these are deliberately
// rejected even though it costs a small number of legitimate handles.
const X_RESERVED_PATHS = new Set([
  "i",
  "home",
  "search",
  "explore",
  "notifications",
  "messages",
  "settings",
  "intent",
  "share",
  "compose",
  "login",
  "signup",
  "privacy",
  "tos",
]);

// Reserved Telegram path segments — service links (invite/join, stickers,
// bots, deep-link actions) rather than a real @username. Most notably
// t.me/joinchat/<hash> (the legacy group invite link format) extracts
// "joinchat" as the first segment; linking that as if it were the
// creator's own account would point visitors at an arbitrary invite, not
// the creator, so it must fail closed to plain text like any other
// unrecognised value. Same trade-off as X_RESERVED_PATHS above: a real
// username could theoretically collide with one of these, and rejecting is
// the right side of that trade-off for a public page.
const TELEGRAM_RESERVED_PATHS = new Set([
  "joinchat",
  "s",
  "c",
  "addstickers",
  "addemoji",
  "proxy",
  "socks",
  "share",
  "iv",
  "setlanguage",
  "confirmphone",
  "login",
  "bg",
]);

type ExtractOptions = {
  hosts: string[];
  pattern: RegExp;
  reservedPaths: Set<string>;
  /** Whether a scheme-less "host/handle" form (no leading http(s)://) is accepted. */
  allowSchemelessHost: boolean;
};

function isSchemelessHostMatch(trimmed: string, hosts: string[]): boolean {
  const lower = trimmed.toLowerCase();
  return hosts.some((host) => {
    const withWww = `www.${host}`;
    return lower === host || lower === withWww || lower.startsWith(`${host}/`) || lower.startsWith(`${withWww}/`);
  });
}

function extractFromUrlForm(candidate: string, options: ExtractOptions): string | null {
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!options.hosts.includes(host)) return null;
    const segment = url.pathname.split("/").filter(Boolean)[0] || "";
    if (!options.pattern.test(segment)) return null;
    if (options.reservedPaths.has(segment.toLowerCase())) return null;
    return segment;
  } catch {
    return null;
  }
}

function extractFromBareForm(trimmed: string, options: ExtractOptions): string | null {
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!options.pattern.test(withoutAt)) return null;
  if (options.reservedPaths.has(withoutAt.toLowerCase())) return null;
  return withoutAt;
}

function extractHandle(raw: unknown, options: ExtractOptions): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasScheme = /^https?:\/\//i.test(trimmed);
  if (hasScheme) return extractFromUrlForm(trimmed, options);

  if (options.allowSchemelessHost && isSchemelessHostMatch(trimmed, options.hosts)) {
    return extractFromUrlForm(`https://${trimmed}`, options);
  }

  return extractFromBareForm(trimmed, options);
}

/**
 * Normalises an X/Twitter field (a profile URL — https://x.com/handle or
 * https://twitter.com/handle — a bare "@handle", or a bare "handle") down to
 * a plain handle, or null if the value is absent, not a string, doesn't look
 * like a real handle, or resolves to a reserved platform path (e.g.
 * x.com/i/flow/login) rather than a profile. Never invents a handle: this
 * only ever echoes what was published in the source field itself.
 *
 * Promoted from the pump.fun creator-handle extraction (issue #298) so both
 * that caller and the public token fallback page (issue #371) share one
 * implementation. Behaviour for the pump.fun caller is unchanged except for
 * the added reserved-path rejection, which affects platform-chrome paths
 * only, not any real handle previously accepted by that caller's tests.
 */
export function extractTwitterHandle(raw: unknown): string | null {
  return extractHandle(raw, {
    hosts: ["x.com", "twitter.com"],
    pattern: TWITTER_HANDLE_PATTERN,
    reservedPaths: X_RESERVED_PATHS,
    // Preserves the pump.fun contract: a scheme-less "twitter.com/handle"
    // was never accepted by the original implementation, only full URLs,
    // "@handle" or a bare handle.
    allowSchemelessHost: false,
  });
}

/**
 * Normalises a Telegram field (t.me/name, telegram.me/name, with or without
 * a scheme, a bare "@name", or a bare "name") down to a plain handle, or
 * null if the value is absent, not a string, doesn't look like a real
 * Telegram username, or resolves to a reserved path (e.g. the legacy
 * t.me/joinchat/<hash> invite-link format) rather than a profile/channel
 * username. Never invents a handle.
 */
export function extractTelegramHandle(raw: unknown): string | null {
  return extractHandle(raw, {
    hosts: ["t.me", "telegram.me"],
    pattern: TELEGRAM_HANDLE_PATTERN,
    reservedPaths: TELEGRAM_RESERVED_PATHS,
    // Schemeless "t.me/name" is common creator input, unlike X's
    // "twitter.com/name" which historically was never accepted.
    allowSchemelessHost: true,
  });
}

/** Builds the canonical X profile URL for an already-normalised handle. */
export function xProfileUrl(handle: string): string {
  return `https://x.com/${handle}`;
}

/** Builds the canonical Telegram profile URL for an already-normalised handle. */
export function telegramProfileUrl(handle: string): string {
  return `https://t.me/${handle}`;
}

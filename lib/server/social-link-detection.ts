// Link detection for the X posting-cost guard (issue #342). X's pay-per-use
// pricing charges roughly 13x more for a post containing a link than a plain
// one, so the posting cron must never send a link-bearing body through the X
// API — see routeXDestination in social-posting-cron.ts. Telegram is
// unaffected (its Bot API is free) and never runs this check.
//
// Deliberately over-inclusive on real links (scheme URLs, www.*, bare
// "word.tld" domains, known shorteners) and deliberately narrow on the TLD
// allowlist so ordinary text isn't mistaken for a link: ONLY an alphabetic
// suffix from COMMON_LINK_TLDS counts as a TLD, so decimal numbers ("3.14"),
// version strings ("v2.0") and abbreviations ("e.g.") never match — their
// final "TLD-position" segment is numeric or a single letter, neither of
// which appears in the allowlist. Cashtags ("$HOOD") never match because
// they contain no dot at all.

const URL_SCHEME_PATTERN = /\bhttps?:\/\/\S+/i;
const WWW_DOMAIN_PATTERN = /\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i;

// Common gTLDs/ccTLDs seen in crypto-project links, plus every domain in
// KNOWN_SHORTENER_DOMAINS below (t.co ends in "co", bit.ly ends in "ly", …
// so they're already covered by this list, not just the explicit set).
const COMMON_LINK_TLDS = [
  "com", "net", "org", "io", "dev", "xyz", "app", "co", "gg", "me", "ai",
  "so", "fun", "finance", "link", "click", "info", "biz", "shop", "live",
  "news", "tv", "cc", "to", "gl", "ly", "fi", "id", "gy", "ink", "gov",
  "edu", "eth", "sol", "page", "site", "online", "pro", "vip", "wtf",
];

const KNOWN_SHORTENER_DOMAINS = [
  "bit.ly", "t.co", "tinyurl.com", "goo.gl", "ow.ly", "is.gd", "buff.ly",
  "rebrand.ly", "cutt.ly", "shorturl.at", "rb.gy", "bl.ink", "lnkd.in",
];

const BARE_DOMAIN_PATTERN = new RegExp(
  `\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${COMMON_LINK_TLDS.join("|")})\\b`,
  "i",
);

const SHORTENER_PATTERN = new RegExp(
  `\\b(?:${KNOWN_SHORTENER_DOMAINS.map((domain) => domain.replace(/\./g, "\\.")).join("|")})\\/?\\S*`,
  "i",
);

/**
 * True if `text` contains anything that looks like a URL: a scheme
 * (http/https), a www.-prefixed domain, a bare "word.tld" domain from the
 * allowlist above, or a known link shortener. Used to gate every X API send
 * — see social-posting-cron.ts.
 */
export function bodyContainsLink(text: string): boolean {
  if (!text) return false;
  return (
    URL_SCHEME_PATTERN.test(text) ||
    WWW_DOMAIN_PATTERN.test(text) ||
    SHORTENER_PATTERN.test(text) ||
    BARE_DOMAIN_PATTERN.test(text)
  );
}

// Shared server-side content filter (issue #392). This is a hard floor, not
// a taste filter: it blocks ONLY (1) slurs/hateful content targeting race,
// ethnicity or national origin, (2) slurs/hateful content targeting
// religion, and (3) content sexualising minors in any form. Profanity,
// crude humour, adult innuendo, violence, drugs and other edgy content are
// deliberately NOT filtered — the ToS covers discretionary removal of
// anything else by hand. Do not widen this list without an explicit owner
// decision (see issue #392).
//
// Server-only. Never import this module from client components — the term
// list must not ship to the browser bundle.

export type ContentFilterCategory = "hateful-slur" | "csam";

type TermEntry = {
  category: ContentFilterCategory;
  /** Lowercase canonical term or phrase. Never logged or echoed back. */
  term: string;
  /** High-severity terms also match common leetspeak/separator evasion. */
  evasive?: boolean;
};

// Owner-maintained, case-insensitive. Single/short words rely on
// word-boundary matching so they never fire on a larger legitimate word
// (e.g. a slur that is a substring of an unrelated English word will not
// match, because `\b` requires a non-word character on both sides).
const HATEFUL_SLUR_TERMS: TermEntry[] = [
  { category: "hateful-slur", term: "nigger", evasive: true },
  { category: "hateful-slur", term: "nigga", evasive: true },
  { category: "hateful-slur", term: "niggers", evasive: true },
  { category: "hateful-slur", term: "chink", evasive: true },
  { category: "hateful-slur", term: "chinks", evasive: true },
  { category: "hateful-slur", term: "gook", evasive: true },
  { category: "hateful-slur", term: "gooks" },
  { category: "hateful-slur", term: "spic", evasive: true },
  { category: "hateful-slur", term: "spics" },
  { category: "hateful-slur", term: "wetback" },
  { category: "hateful-slur", term: "wetbacks" },
  { category: "hateful-slur", term: "beaner" },
  { category: "hateful-slur", term: "beaners" },
  { category: "hateful-slur", term: "kike", evasive: true },
  { category: "hateful-slur", term: "kikes" },
  { category: "hateful-slur", term: "coon", evasive: true },
  { category: "hateful-slur", term: "coons" },
  { category: "hateful-slur", term: "paki" },
  { category: "hateful-slur", term: "pakis" },
  { category: "hateful-slur", term: "raghead" },
  { category: "hateful-slur", term: "ragheads" },
  { category: "hateful-slur", term: "sandnigger", evasive: true },
  { category: "hateful-slur", term: "towelhead" },
  { category: "hateful-slur", term: "towelheads" },
  { category: "hateful-slur", term: "wop" },
  { category: "hateful-slur", term: "wops" },
  { category: "hateful-slur", term: "dago" },
  { category: "hateful-slur", term: "dagos" },
  { category: "hateful-slur", term: "gypsy" },
  { category: "hateful-slur", term: "gypsies" },
  { category: "hateful-slur", term: "redskin" },
  { category: "hateful-slur", term: "redskins" },
  { category: "hateful-slur", term: "injun" },
  { category: "hateful-slur", term: "injuns" },
  { category: "hateful-slur", term: "jap", evasive: true },
  { category: "hateful-slur", term: "japs" },
  { category: "hateful-slur", term: "zipperhead" },
  { category: "hateful-slur", term: "cracka" },
  { category: "hateful-slur", term: "porch monkey" },
  { category: "hateful-slur", term: "sand monkey" },
  { category: "hateful-slur", term: "curry muncher" },
  { category: "hateful-slur", term: "camel jockey" },
  // Religious slurs / hateful terms
  { category: "hateful-slur", term: "kaffir" },
  { category: "hateful-slur", term: "muzzrat" },
  { category: "hateful-slur", term: "mudslime" },
  { category: "hateful-slur", term: "papist" },
  { category: "hateful-slur", term: "christ killer" },
  { category: "hateful-slur", term: "heathen scum" },
  { category: "hateful-slur", term: "infidel scum" },
];

// Explicit multi-word phrases describing sexualised-minor content — the
// legal floor. This deliberately does not include broader "adult" terms.
const CSAM_PHRASES: TermEntry[] = [
  { category: "csam", term: "child porn", evasive: true },
  { category: "csam", term: "childporn", evasive: true },
  { category: "csam", term: "kiddie porn" },
  { category: "csam", term: "kiddy porn" },
  { category: "csam", term: "preteen porn" },
  { category: "csam", term: "underage porn" },
  { category: "csam", term: "child sex" },
  { category: "csam", term: "children porn" },
  { category: "csam", term: "loli porn" },
  { category: "csam", term: "lolicon" },
  { category: "csam", term: "shotacon" },
  { category: "csam", term: "jailbait" },
  { category: "csam", term: "cp porn" },
  { category: "csam", term: "minor sex" },
  { category: "csam", term: "child nude" },
  { category: "csam", term: "kid nude" },
  { category: "csam", term: "naked child" },
  { category: "csam", term: "naked minor" },
  { category: "csam", term: "sexy child" },
  { category: "csam", term: "sexy minor" },
  { category: "csam", term: "sexualize children" },
  { category: "csam", term: "sexualise children" },
  { category: "csam", term: "sexualize minors" },
  { category: "csam", term: "sexualise minors" },
];

const ALL_TERMS: TermEntry[] = [...HATEFUL_SLUR_TERMS, ...CSAM_PHRASES];

export const CONTENT_FILTER_TERM_COUNT = ALL_TERMS.length;

export const CONTENT_FILTER_CATEGORY_LABELS: Record<ContentFilterCategory, string> = {
  "hateful-slur": "Race, ethnicity, national origin and religious slurs",
  csam: "Sexualisation of minors",
};

export const CONTENT_FILTER_CATEGORY_COUNT = Object.keys(CONTENT_FILTER_CATEGORY_LABELS).length;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Common leetspeak / separator-evasion substitutions, applied only to
// high-severity single-word terms (multi-word phrases already require an
// exact word match per component and are long enough that evasion is rare).
const LEET_ALTERNATES: Record<string, string> = {
  a: "a4@",
  e: "e3",
  i: "i1!|",
  o: "o0",
  s: "s5$",
  t: "t7",
  g: "g9",
};

function buildEvasivePattern(term: string): string {
  const body = term
    .split("")
    .map((char) => {
      const alternates = LEET_ALTERNATES[char];
      const charClass = alternates ? `[${escapeRegExp(alternates)}]` : escapeRegExp(char);
      return `${charClass}[\\s._*-]*`;
    })
    .join("");
  // Trim the trailing separator-allowance group so the boundary lookahead
  // below sits directly against the final matched character.
  return body.replace(/\[\\s\._\*-\]\*$/, "");
}

function buildPlainPattern(term: string): string {
  // Multi-word phrases: allow flexible whitespace between words.
  return term
    .split(/\s+/)
    .map((word) => escapeRegExp(word))
    .join("\\s+");
}

type CompiledTerm = { category: ContentFilterCategory; regex: RegExp };

function compileTerms(entries: TermEntry[]): CompiledTerm[] {
  return entries.map((entry) => {
    const pattern = entry.evasive ? buildEvasivePattern(entry.term) : buildPlainPattern(entry.term);
    // (?<![a-z0-9]) / (?![a-z0-9]) rather than \b so evasive patterns whose
    // first/last character is a symbol class still get a real boundary
    // check against alphanumerics on either side.
    return { category: entry.category, regex: new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`, "i") };
  });
}

let compiledTermsCache: CompiledTerm[] | null = null;

function getCompiledTerms(): CompiledTerm[] {
  if (!compiledTermsCache) compiledTermsCache = compileTerms(ALL_TERMS);
  return compiledTermsCache;
}

export type ContentFilterMatch = { category: ContentFilterCategory };

/** Scans one string. Never returns or logs the matched term itself. */
export function scanForBlockedContent(text: string): ContentFilterMatch | null {
  if (!text) return null;
  const normalised = text.normalize("NFKC");
  for (const { category, regex } of getCompiledTerms()) {
    regex.lastIndex = 0;
    if (regex.test(normalised)) return { category };
  }
  return null;
}

export type BlockedField = { field: string; category: ContentFilterCategory };

/** Scans a set of named fields, returning the first blocked one (if any). */
export function findBlockedField(
  fields: Record<string, string | null | undefined>,
): BlockedField | null {
  for (const [field, value] of Object.entries(fields)) {
    if (typeof value !== "string" || !value) continue;
    const match = scanForBlockedContent(value);
    if (match) return { field, category: match.category };
  }
  return null;
}

export type ContentFilterOutcome = { blocked: false } | { blocked: true; field: string };

/**
 * Fail-closed: used at publishing and pre-send posting checkpoints. Any
 * unexpected runtime error is treated as a rejection, never a pass-through.
 */
export function runContentFilterFailClosed(
  fields: Record<string, string | null | undefined>,
): ContentFilterOutcome {
  try {
    const found = findBlockedField(fields);
    return found ? { blocked: true, field: found.field } : { blocked: false };
  } catch (error) {
    console.error(
      "Content filter crashed; failing closed and rejecting.",
      error instanceof Error ? error.message : error,
    );
    return { blocked: true, field: "content" };
  }
}

/**
 * Fail-open: used at generation checkpoints, where a crashed filter must
 * not take down site/draft generation. The crash is logged either way.
 */
export function runContentFilterFailOpen(
  fields: Record<string, string | null | undefined>,
): ContentFilterOutcome {
  try {
    const found = findBlockedField(fields);
    return found ? { blocked: true, field: found.field } : { blocked: false };
  } catch (error) {
    console.error(
      "Content filter crashed; failing open (allowing) for a generation checkpoint.",
      error instanceof Error ? error.message : error,
    );
    return { blocked: false };
  }
}

/** Plain-English, field-naming message. Never echoes the matched term. */
export function contentFilterRejectionMessage(field: string): string {
  return `The ${field} was rejected by our content safety filter (hateful slurs and sexualisation of minors are not allowed). Please revise this field and try again.`;
}

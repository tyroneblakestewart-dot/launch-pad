// Client-side hygiene for "Teach the AI your voice" (issue #340). Pasting
// copied web page content (nav labels, copyright lines, ad slots) used to be
// counted and sent to /api/social/voice-profile as if it were real voice
// examples. This filters that furniture out before counting/sending, while
// leaving the user's raw pasted text untouched in the textarea itself.

export const MIN_VOICE_EXAMPLE_LENGTH = 15;
export const MIN_USABLE_VOICE_EXAMPLES = 2;

const BOILERPLATE_LINE_PATTERNS: RegExp[] = [
  /^[\W_]+$/u, // punctuation/symbols only, no letters or digits
  /^©/, // copyright line
  /\(c\)\s*\d{4}/i,
  /all rights reserved/i,
  /^(ads?|advertisement|sponsored)\b/i,
  /^\d+$/, // a bare number (e.g. a stray page count)
  /^(more|menu|home|log ?in|log ?out|sign ?up|sign ?in|subscribe|share|follow|reply|retweet|repost|like|comment|comments|skip to content|cookie policy|privacy policy|terms of service|back to top)$/i,
];

export type VoiceExampleFilterResult = {
  /** Non-empty pasted lines, before hygiene filtering. */
  pastedLines: string[];
  /** Lines that pass the hygiene filter, de-duplicated, in original order. */
  usable: string[];
  /** How many non-empty lines were pasted in total. */
  pastedLineCount: number;
  /** How many of the pasted lines were rejected (too short, boilerplate, or duplicate). */
  rejectedCount: number;
};

function isBoilerplateLine(line: string): boolean {
  return BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

// A pasted post usually arrives with its chrome: the author's display name,
// the @handle, a relative timestamp or "· 2h", "Show more", engagement counts
// and a trailing line of hashtags. None of that is the person's voice. These
// patterns identify a line that is chrome rather than body.
const HANDLE_LINE = /^@[A-Za-z0-9_]{1,30}(\s*[·•]\s*.*)?$/;
const TIMESTAMP_LINE = /^(\d{1,2}:\d{2}\s*(AM|PM)?\s*[·•]\s*)?(\d{1,2}\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*\d{0,2},?\s*\d{0,4}(\s*[·•].*)?$/i;
const RELATIVE_TIME_LINE = /^[·•]?\s*\d{1,2}\s?(s|m|h|d|w|min|mins|hr|hrs|hour|hours|day|days|week|weeks)\s*(ago)?$/i;
const ENGAGEMENT_LINE = /^[\d.,]+\s?[KkMm]?\s+(replies?|reposts?|retweets?|likes?|views?|quotes?|bookmarks?|comments?|shares?)\b.*$/i;
const CHROME_LINE =
  /^(show more|show this thread|read more|see more|translate post|translate tweet|follow|following|verified account|pinned|promoted|ad|quote|square profile picture|profile picture|opens profile photo|image|gif|video|the following media includes potentially sensitive content|replying to .*)$/i;
// A lone separator — X renders "·" between the handle and the time on its own line when copied.
const SEPARATOR_LINE = /^[·•.\-–—|\s]+$/;
const HASHTAG_ONLY_LINE = /^(#[\p{L}\p{N}_]+\s*)+$/u;
const MENTION_ONLY_LINE = /^(@[A-Za-z0-9_]+\s*)+$/;

function isPostChromeLine(line: string): boolean {
  return (
    SEPARATOR_LINE.test(line) ||
    HANDLE_LINE.test(line) ||
    TIMESTAMP_LINE.test(line) ||
    RELATIVE_TIME_LINE.test(line) ||
    ENGAGEMENT_LINE.test(line) ||
    CHROME_LINE.test(line) ||
    MENTION_ONLY_LINE.test(line)
  );
}

/**
 * Strips a pasted post down to what the person actually wrote. Given the
 * lines of ONE post: the display-name line is dropped wherever it sits, being
 * the line directly above an @handle,
 * every chrome line is dropped wherever it appears, trailing hashtag-only
 * lines are dropped, and the remaining body lines are joined into one line so
 * the rest of the trainer's one-example-per-line contract is unchanged.
 * Returns "" when nothing but chrome was pasted.
 */
export function stripPostChrome(postLines: readonly string[]): string {
  const lines = postLines.map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return "";

  const body: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1];
    // Display-name line: the line sitting directly above an @handle, wherever it
    // falls — X's copied alt text ("Square profile picture") often precedes it.
    if (next !== undefined && HANDLE_LINE.test(next) && !isPostChromeLine(line)) continue;
    if (isPostChromeLine(line)) continue;
    body.push(line);
  }

  // Trailing hashtag-only lines are tags, not voice.
  while (body.length > 0 && HASHTAG_ONLY_LINE.test(body[body.length - 1])) body.pop();

  return body.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Splits raw pasted text into posts.
 *
 * Copied X posts carry chrome — "Name" then "@handle" above the body — and
 * their bodies often run to several paragraphs separated by blank lines. So
 * when a paste contains ANY post chrome, a new post starts only at the next
 * display-name/@handle pair (or a bare @handle line), and blank lines are
 * paragraph breaks inside the current post, never boundaries. A paste with no
 * chrome at all keeps the trainer's original contract: one example per
 * non-empty line. Each post is then reduced to its body with stripPostChrome
 * and empty results are dropped.
 */
export function cleanPastedPosts(rawText: string): string[] {
  const lines = rawText.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim());
  const hasChrome = lines.some((line) => line && isPostChromeLine(line));

  if (!hasChrome) {
    return lines.filter(Boolean);
  }

  const posts: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) posts.push(current);
    current = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue; // paragraph break, not a new post
    const next = lines[index + 1];
    const startsWithNameHandle = next !== undefined && HANDLE_LINE.test(next) && !isPostChromeLine(line);
    const startsWithBareHandle = HANDLE_LINE.test(line) && !(index > 0 && lines[index - 1] && !isPostChromeLine(lines[index - 1]));
    if (current.some((existing) => !isPostChromeLine(existing)) && (startsWithNameHandle || startsWithBareHandle)) {
      flush();
    }
    current.push(line);
  }
  flush();

  return posts.map(stripPostChrome).filter(Boolean);
}

/** Separates real voice examples from page furniture: short lines, boilerplate, and case-insensitive duplicates are excluded from `usable`. */
export function filterUsableVoiceExamples(rawText: string): VoiceExampleFilterResult {
  const pastedLines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const usable: string[] = [];
  for (const line of pastedLines) {
    if (line.length < MIN_VOICE_EXAMPLE_LENGTH) continue;
    if (isBoilerplateLine(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    usable.push(line);
  }

  return {
    pastedLines,
    usable,
    pastedLineCount: pastedLines.length,
    rejectedCount: pastedLines.length - usable.length,
  };
}

/** The design's ideal example count — the "/ 20" in the trainer, and the target the hint line counts down to. */
export const VOICE_EXAMPLE_TARGET = 20;

/**
 * The one-line hint under the EXAMPLES ADDED bar, from the design's own
 * copy: nothing yet / how many more until the voice "locks in" / trained.
 */
export function voiceTrainingHint(usableCount: number, target: number = VOICE_EXAMPLE_TARGET): string {
  const count = Math.max(0, Math.floor(usableCount));
  if (count === 0) return "Nothing added yet — paste your first example above.";
  if (count < target) {
    const remaining = target - count;
    return `Add ${remaining} more and the voice locks in properly.`;
  }
  return "Perfect — the voice is fully trained.";
}

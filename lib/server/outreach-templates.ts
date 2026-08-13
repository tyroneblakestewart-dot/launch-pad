// Congratulation-only copy pool for the dormant X outreach bot (issue #298).
// No product pitch, no sales language, ever — every template here only
// congratulates a token on its pump.fun graduation progress. Every single
// template (first-touch and follow-up) must name the official
// @hoodlumsdev handle so the post always credits the graduation board that
// spotted it; the cashtag is always present; the token creator's own X
// handle (a different handle from @hoodlumsdev) is only ever mentioned when
// it was published in that token's own pump.fun metadata (see
// lib/server/pumpfun-graduating.ts's creatorXHandle) — never invented.
//
// Kept in lib/server/ (rather than lib/) even though every function here is
// pure and has no server-only dependency: nothing in this repo needs to
// build or rotate outreach copy from the browser, so the safer default is
// to keep it out of the client bundle.

export type OutreachTouch = "first" | "followup";

export type OutreachTemplateToken = {
  name: string;
  ticker: string;
  progressPercent: number;
  creatorXHandle: string | null;
};

export type OutreachTemplate = {
  key: string;
  touch: OutreachTouch;
  build: (token: OutreachTemplateToken) => string;
};

function pct(token: OutreachTemplateToken): number {
  return Math.round(Math.min(100, Math.max(0, token.progressPercent)));
}

function cashtag(token: OutreachTemplateToken): string {
  return `$${token.ticker}`;
}

/** A leading-space creator mention, or "" when the creator never published a handle. */
function mention(token: OutreachTemplateToken): string {
  return token.creatorXHandle ? ` @${token.creatorXHandle}` : "";
}

// At least 8 rotating first-touch templates. Deliberately varied in
// emoji use, casing, and sentence structure so consecutive posts never
// read identical even before random rotation is applied.
export const FIRST_TOUCH_TEMPLATES: readonly OutreachTemplate[] = [
  {
    key: "first-board-doesnt-lie",
    touch: "first",
    build: (t) =>
      `the @hoodlumsdev graduation board doesn't lie 👀 ${cashtag(t)} at ${pct(t)}% — congrats${mention(t)}, that's a serious run.`,
  },
  {
    key: "first-just-cracked",
    touch: "first",
    build: (t) =>
      `${cashtag(t)} just cracked ${pct(t)}% on the @hoodlumsdev graduation board. strong work${mention(t)} — keep cooking.`,
  },
  {
    key: "first-watching-climb",
    touch: "first",
    build: (t) =>
      `WATCHING ${cashtag(t)} climb toward graduation — ${pct(t)}% and counting on the @hoodlumsdev board${mention(t) || " 🫡"}. respect.`,
  },
  {
    key: "first-great-look",
    touch: "first",
    build: (t) =>
      `not gonna lie, ${cashtag(t)} at ${pct(t)}% on the @hoodlumsdev graduation board is a great look${mention(t)}. congrats on the momentum.`,
  },
  {
    key: "first-solid-work",
    touch: "first",
    build: (t) =>
      `the @hoodlumsdev board has ${cashtag(t)} at ${pct(t)}% right now 📈 solid work${mention(t)} — this one's cooking.`,
  },
  {
    key: "first-thats-the-post",
    touch: "first",
    build: (t) => `${pct(t)}%. ${cashtag(t)}. the @hoodlumsdev graduation board. that's it, that's the post 👏${mention(t)}`,
  },
  {
    key: "first-crew-sees-you",
    touch: "first",
    build: (t) =>
      `congrats${mention(t)} — ${cashtag(t)} is sitting pretty at ${pct(t)}% on the @hoodlumsdev graduation board. the crew sees you 👀`,
  },
  {
    key: "first-showing-up-strong",
    touch: "first",
    build: (t) =>
      `${cashtag(t)} showing up strong on the @hoodlumsdev graduation board at ${pct(t)}%${mention(t)}. keep it up 🔥`,
  },
];

// At least 3-4 optional second-touch templates, sent only if a mint we
// already congratulated actually graduates.
export const FOLLOWUP_TEMPLATES: readonly OutreachTemplate[] = [
  {
    key: "followup-caught-it-early",
    touch: "followup",
    build: (t) =>
      `🎓 ${cashtag(t)} graduated! caught it on the @hoodlumsdev board the whole way up — congrats${mention(t)}, well earned.`,
  },
  {
    key: "followup-official",
    touch: "followup",
    build: (t) =>
      `it's official: ${cashtag(t)} graduated 🎉 the @hoodlumsdev graduation board called it early${mention(t)}. congrats on seeing it through.`,
  },
  {
    key: "followup-made-it",
    touch: "followup",
    build: (t) =>
      `${cashtag(t)} made it — fully graduated now. the @hoodlumsdev crew watched the climb${mention(t)} and had to say congrats.`,
  },
  {
    key: "followup-graduation-day",
    touch: "followup",
    build: (t) => `graduation day for ${cashtag(t)} 🎓 the @hoodlumsdev board tracked the whole run${mention(t)}. nicely done.`,
  },
];

/**
 * Random-with-no-immediate-repeat template selection. `previousKey` is the
 * template key most recently used for this same touch type (across the
 * whole queue, not just this cron run), so consecutive drafts never reuse
 * the same template even across separate cron invocations. `random` is
 * injectable for deterministic tests.
 */
export function pickOutreachTemplate(
  pool: readonly OutreachTemplate[],
  previousKey: string | null,
  random: () => number = Math.random,
): OutreachTemplate {
  const candidates = previousKey && pool.length > 1 ? pool.filter((template) => template.key !== previousKey) : pool;
  const index = Math.min(Math.floor(random() * candidates.length), candidates.length - 1);
  return candidates[Math.max(0, index)];
}

export function buildOutreachDraftBody(template: OutreachTemplate, token: OutreachTemplateToken): string {
  return template.build(token);
}

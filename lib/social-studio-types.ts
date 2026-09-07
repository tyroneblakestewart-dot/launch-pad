import { DEFAULT_TONE_DIALS, DEFAULT_WORDS_TO_AVOID, WORDS_TO_AVOID_SEED_VERSION, type ToneDials } from "./social-tone-rules";
import { DEFAULT_QUIET_HOURS, type QuietHours } from "./social-quiet-hours";
// Client-safe types shared between components/social-hub.tsx and the new
// AI Social Studio server routes. Kept separate from lib/server/* so the
// client bundle never pulls in server-only modules.

export type VoiceProfile = {
  tone: string;
  vocabulary: string;
  cadence: string;
  emojiHabits: string;
  sampleLines: [string, string, string];
  exampleCount: number;
  updatedAt: string;
};

/** The mascot's locked visual identity, extracted once from an uploaded reference image. */
export type MascotVisualDNA = {
  characterDescription: string;
  colourPalette: string;
  signatureProps: string;
  artStyle: string;
};

export type SocialDraft = {
  xText: string;
  telegramText: string;
};

/**
 * Feedback on one AI-written Voice preview sample line — "sounds like me"
 * vs "not me" (issue #348). This is purely a style-reinforcement signal,
 * never a publish action: liked lines feed back into future voice-profile
 * and draft generation as capped, secondary reinforcement examples.
 */
export type SampleLineFeedback = {
  text: string;
  /** "fire" and "liked" are kept in the persona bank (fire is protected from Clear 50%); "disliked" is binned. */
  sentiment: "fire" | "liked" | "disliked";
  updatedAt: string;
};

/** Mirrors lib/server/social-connections-store.ts's SocialPlatform without importing a server-only module into the client bundle. */
export type SocialPlatform = "x" | "telegram";

export type QueueItem = {
  id: string;
  xText: string;
  telegramText: string;
  artwork: string | null;
  source: "setup-ai" | "calendar-ai" | "manual" | "auto-replenish" | "announcement" | "announcement-ai";
  dayLabel: string | null;
  /**
   * The local calendar day ("YYYY-MM-DD") the user picked on the Calendar
   * tab when they tapped "AI makes it" — the day the post is scheduled on
   * when approved, unless the user picks their own time in the Queue.
   * Absent on Setup, manual and replenish drafts (and on pre-existing
   * calendar drafts, which fall back to the cadence spread as before).
   */
  scheduledDay?: string | null;
  /**
   * The time of day ("HH:MM", local) picked on the Calendar tab beside the
   * date (owner direction, 7 Sep 2026) — with `scheduledDay`, the exact
   * default the post is scheduled for at approval. Absent means the first
   * waking slot logic applies.
   */
  scheduledTime?: string | null;
  createdAt: string;
  /** The angle the draft route wrote this post to (DRAFT_ANGLES key) — ranks it for an AI image. Absent on manual and pre-existing drafts. */
  angleKey?: string | null;
  /** The user said "no image" for this post (skipped or removed) — never picked again, per the owner's no-remake rule. */
  imageDeclined?: boolean;
  /** `artwork` was made by the AI for this post at approve time, as opposed to project or mascot artwork the user attached. */
  aiImage?: boolean;
};

/** Default and cap for issue #352's "always something loaded" Ready-to-review pool size, user-configurable in Settings & Rules. */
export const DEFAULT_QUEUE_TARGET = 5;
export const MAX_QUEUE_TARGET = 20;

/**
 * Posting cadence (issue #358): a single-select pair of daily posting tiers,
 * each hard-capped by the plan entitlement (Pro: 5 posts/day, Pro Bundle:
 * 5 posts/day per token) — `postsPerDayMax` must never exceed
 * MAX_POSTS_PER_DAY, and no third, higher tier should be added.
 */
export type PostingCadence = "conservative" | "active";

export const MAX_POSTS_PER_DAY = 5;

/**
 * Daily mascot-image allowance per token (owner decision, 5 Sep 2026): two a
 * day, hard-blocked at the cap until the next UTC midnight. A Pro Bundle wallet
 * gets this on each of its tokens, not a shared pool. Enforced server-side in
 * app/api/social/mascot/image/route.ts; shown client-side as "N/2 AI images".
 */
export const MAX_MASCOT_IMAGES_PER_DAY = 2;

export const POSTING_CADENCE_OPTIONS: Array<{
  id: PostingCadence;
  label: string;
  description: string;
  postsPerDayMax: number;
}> = [
  { id: "conservative", label: "Conservative", description: "1–2 posts per day", postsPerDayMax: 2 },
  { id: "active", label: "Active", description: "3–5 posts per day", postsPerDayMax: 5 },
];

export const DEFAULT_POSTING_CADENCE: PostingCadence = "active";

export type SocialStudioProjectRecord = {
  voiceProfile: VoiceProfile | null;
  voiceExamples: string[];
  mascotVisualDNA: MascotVisualDNA | null;
  mascotReferenceImage: string | null;
  queue: QueueItem[];
  sampleLineFeedback: SampleLineFeedback[];
  queueTarget: number;
  /** Single-select daily posting tier (issue #358) driving queueTarget and the default schedule spread. */
  postingCadence: PostingCadence;
  /** Optional free-text steering for AI drafts (issue #358) — "Tell the AI your focus this week." Empty by default; empty changes nothing about generation. */
  directionBrief: string;
  /** Lower-cased pasted posts already reshaped and sorted in the station, so a source is never served twice. */
  sortedVoiceSourceKeys: string[];
  /** Settings & Rules "Words to avoid" (owner direction, 6 Sep 2026) — every AI draft is forbidden these and mechanically rejected if one slips through. */
  wordsToAvoid: string[];
  /** Which default-word seed this record has received (7 Sep 2026): a record below WORDS_TO_AVOID_SEED_VERSION gets the subject words added once on read, and never again once saved. */
  wordsToAvoidSeed: number;
  /** Settings & Rules "How it should sound" dials (owner direction, 6 Sep 2026) — fed into every AI draft as tone instructions. */
  toneDials: ToneDials;
  /** Calendar "Quiet hours" (owner direction, 7 Sep 2026): no post is ever scheduled inside this local-time window; `null` is off. */
  quietHours: QuietHours | null;
};

export const EMPTY_SOCIAL_STUDIO_RECORD: SocialStudioProjectRecord = {
  voiceProfile: null,
  voiceExamples: [],
  mascotVisualDNA: null,
  mascotReferenceImage: null,
  queue: [],
  sampleLineFeedback: [],
  queueTarget: DEFAULT_QUEUE_TARGET,
  postingCadence: DEFAULT_POSTING_CADENCE,
  directionBrief: "",
  sortedVoiceSourceKeys: [],
  wordsToAvoid: [...DEFAULT_WORDS_TO_AVOID],
  wordsToAvoidSeed: WORDS_TO_AVOID_SEED_VERSION,
  toneDials: { ...DEFAULT_TONE_DIALS },
  quietHours: { ...DEFAULT_QUIET_HOURS },
};

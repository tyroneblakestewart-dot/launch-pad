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
  sentiment: "liked" | "disliked";
  updatedAt: string;
};

export type QueueItem = {
  id: string;
  xText: string;
  telegramText: string;
  artwork: string | null;
  source: "setup-ai" | "calendar-ai" | "manual";
  dayLabel: string | null;
  createdAt: string;
};

export type SocialStudioProjectRecord = {
  voiceProfile: VoiceProfile | null;
  voiceExamples: string[];
  mascotVisualDNA: MascotVisualDNA | null;
  mascotReferenceImage: string | null;
  queue: QueueItem[];
  sampleLineFeedback: SampleLineFeedback[];
};

export const EMPTY_SOCIAL_STUDIO_RECORD: SocialStudioProjectRecord = {
  voiceProfile: null,
  voiceExamples: [],
  mascotVisualDNA: null,
  mascotReferenceImage: null,
  queue: [],
  sampleLineFeedback: [],
};

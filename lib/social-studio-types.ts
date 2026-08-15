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
};

export const EMPTY_SOCIAL_STUDIO_RECORD: SocialStudioProjectRecord = {
  voiceProfile: null,
  voiceExamples: [],
  mascotVisualDNA: null,
  mascotReferenceImage: null,
  queue: [],
};

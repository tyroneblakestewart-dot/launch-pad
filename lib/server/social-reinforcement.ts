// Server-side defence-in-depth for liked-sample-line reinforcement (issue
// #348). The client already caps and orders what it sends (see
// lib/social-voice-feedback.ts), but the request body is user-controlled,
// so the server re-validates rather than trusting the client's cap.

import { MAX_REINFORCEMENT_SAMPLE_LINES } from "@/lib/social-voice-feedback";

export const MAX_REINFORCEMENT_SAMPLE_LINE_LENGTH = 280;

/** Cleans an incoming likedSampleLines payload: strings only, trimmed, non-empty, length-capped, count-capped, order preserved (caller sends most-recent-first). */
export function normaliseLikedSampleLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length <= MAX_REINFORCEMENT_SAMPLE_LINE_LENGTH)
    .slice(0, MAX_REINFORCEMENT_SAMPLE_LINES);
}

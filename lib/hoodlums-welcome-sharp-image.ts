import { HOODLUMS_WELCOME_SHARP_PART_00 } from "./hoodlums-welcome-sharp/part-00";
import {
  HOODLUMS_WELCOME_SHARP_PART_01,
  HOODLUMS_WELCOME_SHARP_PART_02,
} from "./hoodlums-welcome-sharp/parts-01-02";

export const HOODLUMS_WELCOME_SHARP_PARTS = [
  HOODLUMS_WELCOME_SHARP_PART_00,
  HOODLUMS_WELCOME_SHARP_PART_01,
  HOODLUMS_WELCOME_SHARP_PART_02,
] as const;

function decodeBase64Chunk(value: string): Uint8Array {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function createHoodlumsWelcomeSharpImageUrl(): string {
  const chunks = HOODLUMS_WELCOME_SHARP_PARTS.map(decodeBase64Chunk);
  return URL.createObjectURL(new Blob(chunks, { type: "image/webp" }));
}

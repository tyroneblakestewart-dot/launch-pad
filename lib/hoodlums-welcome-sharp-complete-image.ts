import { HOODLUMS_WELCOME_COMPLETE_PART_00 } from "./hoodlums-welcome-sharp-complete/part-00";
import { HOODLUMS_WELCOME_COMPLETE_PART_01 } from "./hoodlums-welcome-sharp-complete/part-01";
import { HOODLUMS_WELCOME_COMPLETE_PART_02 } from "./hoodlums-welcome-sharp-complete/part-02";
import {
  HOODLUMS_WELCOME_COMPLETE_PART_03,
  HOODLUMS_WELCOME_COMPLETE_PART_04,
} from "./hoodlums-welcome-sharp-complete/parts-03-04";
import {
  HOODLUMS_WELCOME_COMPLETE_PART_05,
  HOODLUMS_WELCOME_COMPLETE_PART_06,
} from "./hoodlums-welcome-sharp-complete/parts-05-06";
import {
  HOODLUMS_WELCOME_COMPLETE_PART_07,
  HOODLUMS_WELCOME_COMPLETE_PART_08,
} from "./hoodlums-welcome-sharp-complete/parts-07-08";
import {
  HOODLUMS_WELCOME_COMPLETE_PART_09,
  HOODLUMS_WELCOME_COMPLETE_PART_10,
} from "./hoodlums-welcome-sharp-complete/parts-09-10";
import {
  HOODLUMS_WELCOME_COMPLETE_PART_11,
  HOODLUMS_WELCOME_COMPLETE_PART_12,
} from "./hoodlums-welcome-sharp-complete/parts-11-12";
import {
  HOODLUMS_WELCOME_COMPLETE_PART_13,
  HOODLUMS_WELCOME_COMPLETE_PART_14,
} from "./hoodlums-welcome-sharp-complete/parts-13-14";
import {
  HOODLUMS_WELCOME_COMPLETE_PART_15,
  HOODLUMS_WELCOME_COMPLETE_PART_16,
} from "./hoodlums-welcome-sharp-complete/parts-15-16";
import { HOODLUMS_WELCOME_COMPLETE_PART_17 } from "./hoodlums-welcome-sharp-complete/part-17";

export const HOODLUMS_WELCOME_COMPLETE_PARTS = [
  HOODLUMS_WELCOME_COMPLETE_PART_00,
  HOODLUMS_WELCOME_COMPLETE_PART_01,
  HOODLUMS_WELCOME_COMPLETE_PART_02,
  HOODLUMS_WELCOME_COMPLETE_PART_03,
  HOODLUMS_WELCOME_COMPLETE_PART_04,
  HOODLUMS_WELCOME_COMPLETE_PART_05,
  HOODLUMS_WELCOME_COMPLETE_PART_06,
  HOODLUMS_WELCOME_COMPLETE_PART_07,
  HOODLUMS_WELCOME_COMPLETE_PART_08,
  HOODLUMS_WELCOME_COMPLETE_PART_09,
  HOODLUMS_WELCOME_COMPLETE_PART_10,
  HOODLUMS_WELCOME_COMPLETE_PART_11,
  HOODLUMS_WELCOME_COMPLETE_PART_12,
  HOODLUMS_WELCOME_COMPLETE_PART_13,
  HOODLUMS_WELCOME_COMPLETE_PART_14,
  HOODLUMS_WELCOME_COMPLETE_PART_15,
  HOODLUMS_WELCOME_COMPLETE_PART_16,
  HOODLUMS_WELCOME_COMPLETE_PART_17,
] as const;

function decodeBase64Chunk(value: string): Uint8Array {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function createHoodlumsWelcomeCompleteImageUrl(): string {
  const chunks = HOODLUMS_WELCOME_COMPLETE_PARTS.map(decodeBase64Chunk);
  return URL.createObjectURL(new Blob(chunks, { type: "image/webp" }));
}

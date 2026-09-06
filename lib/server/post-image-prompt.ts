// Prompt for an AI image made to match one approved social post (owner
// decision, 6 Sep 2026). Two modes: a project with a locked mascot gets a
// mascot scene through the existing lib/server/mascot-prompt-builder.ts
// formula with the post as the scene; a project without one gets an
// on-brand illustration built from the post and the token's own facts.

import { buildMascotImagePrompt, type MascotVisualDNA } from "@/lib/server/mascot-prompt-builder";

export const MAX_POST_IMAGE_SCENE_LENGTH = 200;
export const MAX_POST_IMAGE_TEXT_LENGTH = 1_000;

export type PostImageProject = {
  name: string;
  ticker: string;
  description?: string;
};

export type PostImagePromptResult = {
  prompt: string;
  /** The post reduced to the scene the image should show. */
  scene: string;
  mode: "mascot" | "brand";
};

const URL_PATTERN = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const HANDLE_PATTERN = /(^|\s)@[A-Za-z0-9_]+/g;
const HASHTAG_PATTERN = /(^|\s)#[\p{L}\p{N}_]+/gu;
const PICTOGRAPH_PATTERN = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/**
 * Turns a post into the scene an image should depict: links, @handles,
 * #hashtags and emoji are noise to an image model and are dropped; the rest
 * is collapsed and cut at a word boundary to the mascot builder's scene cap.
 */
export function derivePostImageScene(postText: string): string {
  const cleaned = postText
    .replace(URL_PATTERN, " ")
    .replace(HANDLE_PATTERN, " ")
    .replace(HASHTAG_PATTERN, " ")
    .replace(PICTOGRAPH_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= MAX_POST_IMAGE_SCENE_LENGTH) return cleaned;
  const cut = cleaned.slice(0, MAX_POST_IMAGE_SCENE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > MAX_POST_IMAGE_SCENE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

function cleanTicker(ticker: string): string {
  return ticker.trim().replace(/^\$/, "").toUpperCase();
}

export function buildPostImagePrompt(input: {
  postText: string;
  project: PostImageProject;
  mascotVisualDNA: MascotVisualDNA | null;
}): PostImagePromptResult {
  const scene = derivePostImageScene(input.postText) || "a moment in the token's everyday world";
  const project = { name: input.project.name.trim(), ticker: cleanTicker(input.project.ticker) };

  if (input.mascotVisualDNA) {
    const { prompt } = buildMascotImagePrompt(input.mascotVisualDNA, scene, project);
    return { prompt, scene, mode: "mascot" };
  }

  const description = (input.project.description ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const sections = [
    `Square social-media illustration for the meme token ${project.name} ($${project.ticker}).`,
    `SUBJECT: illustrate the moment described in this post as one clear action or scene, not a static logo or emblem: "${scene}".`,
    description ? `PROJECT: ${description}` : "",
    "STYLE: bold flat vector meme illustration, thick clean outlines, high contrast, one focal subject, a simple uncluttered background, readable at thumbnail size.",
    "COLOUR: a confident two-to-three colour palette with one accent, consistent across the whole image.",
    "TEXT: no words, letters, numbers, logos, watermarks or interface screenshots anywhere in the image — the post carries the words.",
    `RULES: only ${project.name} ($${project.ticker}) may be referenced by the scene; depict no other project's name, ticker, mascot or logo, no seed phrases, private keys or real wallet UI, and no real people.`,
  ].filter(Boolean);
  return { prompt: sections.join("\n\n"), scene, mode: "brand" };
}

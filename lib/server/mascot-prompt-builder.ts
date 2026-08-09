/**
 * Prompt-construction engine for the AI Social Studio's "Drop your mascot"
 * feature. See docs/mascot-image-generation.md for the full spec this
 * implements. This module only assembles prompt text — there is no image
 * API wiring here.
 */

/** The mascot's locked visual identity, extracted once from the user's upload. */
export type MascotVisualDNA = {
  /** The character itself: species/type and distinguishing features. */
  characterDescription: string;
  /** The recurring colour palette used to render the mascot. */
  colourPalette: string;
  /** Recurring accessories/objects that must appear consistently. */
  signatureProps: string;
  /** Rendering/art style (e.g. "flat vector meme illustration, bold outlines"). */
  artStyle: string;
};

export type MascotProject = {
  name: string;
  ticker: string;
};

export type MascotScenePreset = "beach" | "trading" | "casino";

export type BuildMascotImagePromptResult = {
  /** The full assembled image-generation prompt. */
  prompt: string;
  /** Which preset scene was matched, or "custom" for free text. */
  sceneKey: MascotScenePreset | "custom";
  /** The scene text actually used, after stripping foreign project references. */
  sanitisedScene: string;
  /** Foreign tickers/names that were found and removed from the scene input. */
  strippedTerms: string[];
};

type SceneExpansion = {
  situation: string;
  cryptoCulture: string;
  memeJoke: string;
  miniStory: string;
  hiddenDetail: string;
};

const SCENE_PRESETS: Record<MascotScenePreset, SceneExpansion> = {
  beach: {
    situation:
      "sprawled in a beach chair that's visibly too small for it, phone held at arm's length, mid-selfie",
    cryptoCulture:
      "the cocktail umbrella in its drink is replaced by a tiny printed all-green candlestick chart",
    memeJoke:
      "the grin is too wide for an ordinary vacation photo — this is \"I sold the top\" energy, not \"I'm relaxing\" energy",
    miniStory:
      "its signature bag is half-buried in the sand nearby, unzipped and spilling out — it left in a hurry to cash out and get here",
    hiddenDetail: "a small sandcastle in the background has a hand-drawn project flag planted on top",
  },
  trading: {
    situation:
      "hunched over a multi-monitor desk setup at night, mid-motion over the mouse",
    cryptoCulture:
      "the monitors show wallet balances and a chart with a sharp vertical green candle; a stack of empty energy drink cans sits nearby",
    memeJoke:
      "its signature accessory has fallen off its face onto the desk — a frozen \"diamond hands\" reaction to watching the chart spike",
    miniStory:
      "a phone lies face-down next to the keyboard with a cracked screen — it got put down hard a few candles ago",
    hiddenDetail: "a sticky note on the monitor bezel reads \"don't panic sell\" in its own messy handwriting",
  },
  casino: {
    situation: "mid-cheer at a blackjack table, one arm thrown in the air, chips scattering",
    cryptoCulture:
      "a small TV in the background shows a red candlestick chart that nobody at the table is watching",
    memeJoke:
      "the contrast between winning big at the table and the red chart nobody's looking at is the whole joke — it's up in the wrong game",
    miniStory:
      "an empty seat next to it has a drink going flat and a phone left face-up, notifications piling up — a friend who stepped away to go check something",
    hiddenDetail: "the dealer's name tag is barely legible, reading like a background gag never called out in the main action",
  },
};

const SCENE_PRESET_KEYS = Object.keys(SCENE_PRESETS) as MascotScenePreset[];

/** `$TICKER`-style cashtags anywhere in free text scene input. */
const CASHTAG_PATTERN = /\$([a-z][a-z0-9]{1,14})\b/gi;

/**
 * Well-known other crypto project names to strip from free-text scene input.
 * Illustrative, not exhaustive — the cashtag pattern above is the primary
 * guardrail since it catches any $TICKER shape, not just names on this list.
 */
const KNOWN_OTHER_PROJECT_NAMES = [
  "bitcoin",
  "ethereum",
  "dogecoin",
  "shiba inu",
  "pepe",
  "solana",
  "dogwifhat",
  "bonk",
  "floki",
  "mog coin",
  "brett",
  "popcat",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes any $TICKER cashtag that isn't the caller's own ticker, and any
 * well-known other-project name, from free-text scene input. Returns the
 * cleaned text plus the list of terms it removed.
 */
function stripForeignProjectReferences(
  text: string,
  ownName: string,
  ownTicker: string,
): { cleaned: string; strippedTerms: string[] } {
  const strippedTerms: string[] = [];
  const normalisedOwnTicker = ownTicker.trim().replace(/^\$/, "").toLowerCase();
  const normalisedOwnName = ownName.trim().toLowerCase();

  let cleaned = text.replace(CASHTAG_PATTERN, (match, ticker: string) => {
    if (ticker.toLowerCase() === normalisedOwnTicker) return match;
    strippedTerms.push(match);
    return "";
  });

  for (const otherName of KNOWN_OTHER_PROJECT_NAMES) {
    if (otherName === normalisedOwnName) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(otherName)}\\b`, "gi");
    cleaned = cleaned.replace(pattern, (match) => {
      strippedTerms.push(match);
      return "";
    });
  }

  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return { cleaned, strippedTerms };
}

function matchScenePreset(sceneInput: string): MascotScenePreset | null {
  const normalised = sceneInput.trim().toLowerCase();
  return SCENE_PRESET_KEYS.find((key) => key === normalised) ?? null;
}

function expandFreeTextScene(sanitisedScene: string, ticker: string): SceneExpansion {
  const scene = sanitisedScene || "a moment in its everyday world";
  return {
    situation: `placed in this scene, reimagined at the mascot's own scale and in its own style: "${scene}"`,
    cryptoCulture:
      "filtered through crypto-native culture — trading slang, meme-coin rituals, on-chain humor — so it reads as something only a crypto native would fully get",
    memeJoke: `the funniest crypto-degen interpretation of "${scene}", staged mid-punchline rather than posed for a portrait`,
    miniStory:
      "a before/after implied by props and pose — visible evidence of what just happened or is about to happen",
    hiddenDetail: `one small background detail worth zooming in for — an easter egg tied to ${ticker}, never spelled out in the main action`,
  };
}

function formatCharacterSection(dna: MascotVisualDNA): string {
  return [
    `CHARACTER (locked — do not alter): ${dna.characterDescription}.`,
    "The mascot is the sole character in the image — no sidekicks, no crowd,",
    "no cameo characters from other projects.",
  ].join(" ");
}

function formatVisualDnaSection(dna: MascotVisualDNA, project: MascotProject): string {
  const ticker = project.ticker.trim().replace(/^\$/, "").toUpperCase();
  return [
    `VISUAL DNA: colour palette — ${dna.colourPalette}. Signature props — ${dna.signatureProps}.`,
    `Art style — ${dna.artStyle}.`,
    `PROJECT REFERENCE: only ${project.name} ($${ticker}) may appear anywhere in the scene`,
    "(signage, screens, clothing, chat bubbles). Do not depict any other project's name, ticker, or logo.",
  ].join(" ");
}

/**
 * Assembles a full image-generation prompt for the mascot, following the
 * CHARACTER + SITUATION + CRYPTO CULTURE + MEME/JOKE + MINI-STORY +
 * HIDDEN DETAILS + VISUAL DNA formula from docs/mascot-image-generation.md.
 *
 * The character DNA and project reference are locked constants for a given
 * user and are identical across every call regardless of scene. Only the
 * scene-derived sections change.
 */
export function buildMascotImagePrompt(
  dna: MascotVisualDNA,
  sceneInput: string,
  project: MascotProject,
): BuildMascotImagePromptResult {
  const preset = matchScenePreset(sceneInput);
  const { cleaned: sanitisedScene, strippedTerms } = stripForeignProjectReferences(
    sceneInput,
    project.name,
    project.ticker,
  );

  const expansion = preset
    ? SCENE_PRESETS[preset]
    : expandFreeTextScene(sanitisedScene, project.ticker.trim().replace(/^\$/, "").toUpperCase());

  const sections = [
    formatCharacterSection(dna),
    `SITUATION: ${expansion.situation}.`,
    `CRYPTO CULTURE: ${expansion.cryptoCulture}.`,
    `MEME/JOKE: ${expansion.memeJoke}.`,
    `MINI-STORY: ${expansion.miniStory}.`,
    `HIDDEN DETAILS: ${expansion.hiddenDetail}.`,
    formatVisualDnaSection(dna, project),
  ];

  return {
    prompt: sections.join("\n\n"),
    sceneKey: preset ?? "custom",
    sanitisedScene,
    strippedTerms,
  };
}

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
  /** The recurring core colours used to render the mascot in every scene. */
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

export type MascotScenePreset =
  | "beach"
  | "celebrating"
  | "trading"
  | "space"
  | "city streets"
  | "office"
  | "casino"
  | "nature";

type DerivedPaletteKey = "industrial" | "winter" | "warm" | "hospitality" | "water";

export type MascotPaletteKey = MascotScenePreset | DerivedPaletteKey | "custom";

export type MascotColourWorld = {
  /** The mascot's own colours, copied directly from visual DNA and never scene-derived. */
  coreColours: string;
  /** The large surfaces and atmosphere belonging to the scene. */
  environmentalColours: string;
  /** Light/dark or warm/cool values used to keep the mascot readable. */
  contrastColours: string;
  /** Small saturated colours reserved for lights, signs, effects, and screens. */
  accentColours: string;
  /** Which palette family supplied the scene colours. */
  paletteKey: MascotPaletteKey;
  /** Presets are hand-authored; free text always reports a derived palette. */
  source: "preset" | "derived";
};

export type BuildMascotImagePromptResult = {
  /** The full assembled image-generation prompt. */
  prompt: string;
  /** Which preset scene was matched, or "custom" for free text. */
  sceneKey: MascotScenePreset | "custom";
  /** The scene text actually used, after stripping foreign project references. */
  sanitisedScene: string;
  /** Foreign tickers/names that were found and removed from the scene input. */
  strippedTerms: string[];
  /** The resolved four-layer colour world used by the assembled prompt. */
  colourWorld: MascotColourWorld;
};

type SceneExpansion = {
  idea: string;
  associations: readonly string[];
  story: string;
  meme: string;
  exaggeration: string;
  details: string;
};

type ScenePalette = Pick<
  MascotColourWorld,
  "environmentalColours" | "contrastColours" | "accentColours"
>;

type SceneDefinition = {
  expansion: SceneExpansion;
  palette: ScenePalette;
};

const SCENE_PRESETS: Record<MascotScenePreset, SceneDefinition> = {
  beach: {
    expansion: {
      idea:
        "the mascot has just cashed out and is trying to relax on a beach, caught mid-selfie rather than posing",
      associations: [
        "an all-green own-project chart still glowing on the phone",
        "the decision to leave immediately after the spike",
        "a hurried trip that leaves the signature bag half-open",
        "sunscreen and a laptop charger spilling from that bag",
        "a beach chair claimed before anything was unpacked",
      ],
      story:
        "fresh footprints, the rushed-open bag, and the still-lit phone show it arrived only seconds ago after watching the move",
      meme:
        "literal \"sold the top and touched grass\" energy — physically on vacation, mentally still on the chart",
      exaggeration:
        "make the beach chair comically too small, the grin absurdly confident, and the green candle on the phone almost vertical",
      details:
        "a small sandcastle built beside the spill trail carries only the user's own project flag; include no unrelated beach props",
    },
    palette: {
      environmentalColours:
        "sun-bleached sand, turquoise water, pale aqua sky, and warm coral shadows",
      contrastColours:
        "deep navy shadow shapes and crisp off-white sunlight that separate the mascot from the bright tropical background",
      accentColours:
        "sunset coral, reflective cyan highlights, and a small amount of functional lime on the phone/chart",
    },
  },
  celebrating: {
    expansion: {
      idea:
        "the mascot is alone in a nightlife-style victory scene, caught at the instant an own-project profit alert turns into an over-the-top celebration",
      associations: [
        "an own-project price alert lighting the phone",
        "the phone raised as proof of the win",
        "a bottle opened to mark that exact alert",
        "the popped cork striking a nearby confetti switch",
        "fresh confetti and foam tracing the path of the celebration",
      ],
      story:
        "the open bottle, still-glowing phone, and confetti only just reaching the floor show the celebration began seconds ago",
      meme: "one green candle is being treated like a championship victory",
      exaggeration:
        "push the confetti blast, bottle spray, and victory pose far beyond reality so the spray arc echoes a rising price chart",
      details:
        "one small ignored reminder says \"take profit?\" while any visible sign or screen uses only the user's own project identity",
    },
    palette: {
      environmentalColours:
        "midnight navy, smoked black, deep plum, and muted gold across the empty nightlife venue",
      contrastColours:
        "champagne cream highlights and cool cyan rim light that cut the mascot cleanly out of the dark room",
      accentColours:
        "magenta neon, electric blue, jackpot gold, and brief white camera-flash effects",
    },
  },
  trading: {
    expansion: {
      idea:
        "the mascot is hunched over a multi-monitor trading desk at night, frozen at the exact moment its own project chart spikes",
      associations: [
        "a sharp vertical green candle on the own-project chart",
        "the mouse hand freezing mid-click",
        "a signature accessory dropping onto the desk from the sudden reaction",
        "a cracked phone left from the previous dip",
        "empty energy-drink cans proving the chart has been watched all night",
        "a handwritten reminder added after those earlier mistakes",
      ],
      story:
        "the cracked phone, exhausted desk, and fresh candle imply a long losing night that may have just turned around",
      meme:
        "a full \"diamond hands\" reaction staged as stunned disbelief rather than calm financial analysis",
      exaggeration:
        "make the green candle impossibly tall, the monitor glow dramatic, and the frozen reaction readable from across the room",
      details:
        "a sticky note on the monitor bezel reads \"don't panic sell\" in the mascot's own messy handwriting",
    },
    palette: {
      environmentalColours:
        "charcoal, graphite, dark slate, and desaturated navy across the desk and room",
      contrastColours:
        "cool white monitor light and pale cyan edge light that separate the mascot from the dark technology environment",
      accentColours:
        "chart green, restrained alert red, amber status lights, and cyan screen glow",
    },
  },
  space: {
    expansion: {
      idea:
        "the mascot is piloting a compact spacecraft whose flight path mimics an own-project candle heading toward an enormous moon",
      associations: [
        "an own-project target marked \"moon\" on a generic navigation display",
        "a launch sequence started to chase that target",
        "thrusters firing hard enough to shake the cockpit",
        "mission notes and snack wrappers floating from the acceleration",
        "a low GAS gauge caused by the long climb",
      ],
      story:
        "scratched controls, a half-finished checklist, and floating wrappers show a solo overnight mission already deep into its journey",
      meme:
        "\"to the moon\" is taken literally while the fuel gauge makes the gas-fee joke visible",
      exaggeration:
        "make the moon enormous, the trajectory absurdly steep, and the thruster trail shaped like a rising candle",
      details:
        "a tiny signal beacon and the spacecraft marking may use only the user's own project name or ticker",
    },
    palette: {
      environmentalColours:
        "near-black space, deep indigo, violet nebula clouds, and cold blue planetary shadows",
      contrastColours:
        "starlight white and silver-blue edge lighting that preserve a crisp mascot silhouette",
      accentColours:
        "electric cyan instrumentation, ultraviolet effects, meteor orange, and restrained neon-green navigation data",
    },
  },
  "city streets": {
    expansion: {
      idea:
        "the mascot is crossing a wet city street at night, trying to look casual just as an own-project alert stops it mid-step",
      associations: [
        "an own-project alert vibrating the phone",
        "the mascot stopping abruptly to look",
        "one foot landing hard in a rain puddle",
        "the puddle reflecting the green chart from the phone",
        "nearby neon catching and multiplying that reflection",
      ],
      story:
        "wet footprints, a fresh splash, and a tipped takeaway cup show the sudden stop interrupted an otherwise ordinary walk",
      meme:
        "the mascot left the desk to clear its head but the chart now appears in every reflection",
      exaggeration:
        "stretch the reflected candle across the whole puddle and make the neon response feel like the city itself noticed the pump",
      details:
        "one street sign or shop display may carry only the user's own project identity, tied directly to the reflected alert",
    },
    palette: {
      environmentalColours:
        "wet asphalt, concrete grey, deep blue night, muted brick, and dark glass",
      contrastColours:
        "warm storefront amber against cool street blue, selected to keep the mascot distinct from both pavement and buildings",
      accentColours:
        "neon lime, cyan signs, red tail-light reflections, and sharp white puddle highlights",
    },
  },
  office: {
    expansion: {
      idea:
        "the mascot is alone after hours, giving an extremely serious boardroom presentation about absurd own-project meme-coin results",
      associations: [
        "a calendar reminder for a performance review",
        "a rushed slide deck prepared for that review",
        "a projector showing the own-project chart",
        "coffee overfilled during the late-night preparation",
        "sticky notes documenting every failed revision",
      ],
      story:
        "cold coffee, rolled-up sleeves, empty chairs, and half-removed notes show the mascot has rehearsed this corporate pitch all night",
      meme:
        "meme-coin chaos is being presented with the gravity of a Fortune 500 earnings call",
      exaggeration:
        "make the laser pointer follow an impossibly tall candle and turn the empty-boardroom seriousness into the visual punchline",
      details:
        "the agenda includes one crossed-out item reading \"touch grass\" and one own-project ticker reference, with no outside brands",
    },
    palette: {
      environmentalColours:
        "warm grey, soft beige, muted navy, dark wood, and low after-hours office light",
      contrastColours:
        "clean white presentation surfaces and deep charcoal shadows that isolate the mascot from the restrained office palette",
      accentColours:
        "screen cyan, status green, sticky-note yellow, and one small warning-red indicator",
    },
  },
  casino: {
    expansion: {
      idea:
        "the mascot is alone at an electronic blackjack table, mid-cheer as the machine declares a win while its own-project chart drops nearby",
      associations: [
        "one risky wager placed on the electronic table",
        "the machine flashing a win",
        "the sudden celebration knocking chips from the tray",
        "a nearby phone receiving a red own-project chart alert",
        "the alert being ignored because the win lights are louder",
      ],
      story:
        "scattered chips, an abandoned strategy card, and the still-blinking alert show the mascot has just chosen which risk to pay attention to",
      meme: "it is winning big in the wrong game",
      exaggeration:
        "make the jackpot lights and chip scatter enormous while the ignored red candle remains unmistakably visible",
      details:
        "one lucky chip may carry the user's own ticker; no dealer, crowd, or unrelated casino prop may appear",
    },
    palette: {
      environmentalColours:
        "black lacquer, burgundy, emerald felt, dark walnut, and smoky casino shadows",
      contrastColours:
        "ivory spotlights and polished gold trim that separate the mascot from the rich dark room",
      accentColours: "roulette red, chip blue, neon violet, and jackpot gold",
    },
  },
  nature: {
    expansion: {
      idea:
        "the mascot is on a solo hike trying to touch grass, caught checking one final own-project notification before putting the phone away",
      associations: [
        "an own-project portfolio notification",
        "the decision to stop checking the screen",
        "the phone being tucked into the signature prop",
        "fresh footprints continuing up the trail",
        "a trail marker becoming the own-project summit flag ahead",
      ],
      story:
        "the open bag, first stretch of uninterrupted footprints, and low morning light show the mascot is only just beginning to disconnect",
      meme:
        "\"touch grass\" is literal, but the last chart check proves the degen habit came along",
      exaggeration:
        "make the landscape enormous, the phone glow comically hard to ignore, and the summit flag visible from an impossible distance",
      details:
        "one leaf, stream reflection, or rock line may echo a candlestick shape, connected to the trail and using no foreign project reference",
    },
    palette: {
      environmentalColours:
        "forest green, moss, earth brown, open sky blue, and soft stone grey",
      contrastColours:
        "sunlit cream and deep evergreen shadow values that keep the mascot readable against foliage",
      accentColours:
        "wildflower magenta, berry red, water cyan, and firefly gold used in small natural details",
    },
  },
};

const SCENE_PRESET_KEYS = Object.keys(SCENE_PRESETS) as MascotScenePreset[];

const PRESET_PALETTE_KEYWORDS: readonly {
  key: MascotScenePreset;
  pattern: RegExp;
}[] = [
  {
    key: "celebrating",
    pattern: /\b(celebrat(?:e|ing|ion)|party|nightclub|club|festival|concert|birthday|victory)\b/i,
  },
  {
    key: "trading",
    pattern: /\b(trad(?:e|ing)|chart|market|computer|terminal|technology|tech|coding|arcade)\b/i,
  },
  { key: "space", pattern: /\b(space|moon|mars|galaxy|orbit|astronaut|rocket|cosmic|planet)\b/i },
  { key: "casino", pattern: /\b(casino|blackjack|poker|roulette|slot|gambl(?:e|ing))\b/i },
  { key: "beach", pattern: /\b(beach|tropical|ocean|island|pool|summer|surf|sand)\b/i },
  { key: "office", pattern: /\b(office|meeting|boardroom|conference|presentation|workplace)\b/i },
  { key: "nature", pattern: /\b(nature|forest|mountain|hiking|camping|garden|jungle|field|trail)\b/i },
  { key: "city streets", pattern: /\b(city|street|urban|rooftop|alley|subway|traffic|downtown)\b/i },
];

const DERIVED_PALETTES: Record<DerivedPaletteKey, ScenePalette> = {
  industrial: {
    environmentalColours:
      "concrete grey, rubber black, brushed steel, dusty blue, and practical overhead lighting",
    contrastColours:
      "clean cool-white highlights and deep charcoal separation chosen around the mascot's locked core colours",
    accentColours:
      "electric lime status lights, amber warnings, and restrained blue screen glow tied to functional equipment",
  },
  winter: {
    environmentalColours:
      "snow white, ice blue, pale grey, and desaturated distant navy",
    contrastColours:
      "deep midnight shadows and warm reflected light that prevent the mascot from disappearing into snow or ice",
    accentColours: "aurora cyan, safety orange, and small violet reflections",
  },
  warm: {
    environmentalColours:
      "sun-baked ochre, terracotta, dusty tan, and deep warm-brown shadows",
    contrastColours:
      "cool sky blue and crisp pale highlights that separate the mascot from the hot environment",
    accentColours:
      "sunset coral, ember orange, and one restrained electric-cyan or lime functional effect",
  },
  hospitality: {
    environmentalColours:
      "warm cream, roasted brown, muted tile, soft sage, and low amber interior light",
    contrastColours:
      "cool window light and dark espresso shadows selected to preserve the mascot silhouette",
    accentColours:
      "menu-board cyan, cherry red, and small golden practical lights",
  },
  water: {
    environmentalColours:
      "storm blue, slate grey, deep teal, and reflective silver water surfaces",
    contrastColours:
      "warm off-white highlights and near-black depth values that separate the mascot from the cool scene",
    accentColours: "lightning violet, warning amber, and sharp cyan reflections",
  },
};

const DERIVED_PALETTE_KEYWORDS: readonly {
  key: DerivedPaletteKey;
  pattern: RegExp;
}[] = [
  {
    key: "industrial",
    pattern: /\b(gym|workout|deadlift|training|warehouse|garage|factory|industrial|workshop)\b/i,
  },
  { key: "winter", pattern: /\b(snow|winter|ice|ski|frozen|blizzard)\b/i },
  { key: "warm", pattern: /\b(desert|fire|sunset|heat|volcano|summer road)\b/i },
  { key: "hospitality", pattern: /\b(cafe|restaurant|kitchen|food|bakery|diner|coffee shop)\b/i },
  { key: "water", pattern: /\b(rain|storm|underwater|river|lake|waterfall|boat)\b/i },
];

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
    idea: `turn "${scene}" into one clear action, decision, or consequence for the mascot rather than a static pose`,
    associations: [
      `the central action naturally implied by "${scene}"`,
      "the immediate physical consequence of that action",
      "the one practical object required by that consequence",
      "visible evidence that the action has been underway for a while",
      "a crypto-native twist applied to that same evidence",
    ],
    story:
      "show a readable before-and-after through the connected chain — what caused the moment, what just happened, and what is about to happen next",
    meme: `find the strongest crypto-native contradiction or punchline inside "${scene}" and stage the mascot at the exact beat where it becomes funny`,
    exaggeration:
      "push one pose, scale difference, reaction, or physical consequence far beyond reality while keeping the mascot recognisable",
    details: `add one small own-project easter egg tied to $${ticker}, plus only scene details that can be traced back through the connected association chain`,
  };
}

function deriveFreeTextPalette(sanitisedScene: string): {
  palette: ScenePalette;
  paletteKey: MascotPaletteKey;
} {
  for (const rule of PRESET_PALETTE_KEYWORDS) {
    if (rule.pattern.test(sanitisedScene)) {
      return { palette: SCENE_PRESETS[rule.key].palette, paletteKey: rule.key };
    }
  }

  for (const rule of DERIVED_PALETTE_KEYWORDS) {
    if (rule.pattern.test(sanitisedScene)) {
      return { palette: DERIVED_PALETTES[rule.key], paletteKey: rule.key };
    }
  }

  const scene = sanitisedScene || "the scene";
  return {
    paletteKey: "custom",
    palette: {
      environmentalColours: `the natural local colours implied by "${scene}", kept one saturation step below the mascot's locked core colours`,
      contrastColours:
        "an opposite-temperature light/dark value chosen after comparing the environment with the mascot's locked core colours, creating a clear silhouette",
      accentColours:
        "one or two saturated colours taken only from lights, signs, effects, screens, or materials already justified by the connected association chain",
    },
  };
}

function resolveColourWorld(
  dna: MascotVisualDNA,
  preset: MascotScenePreset | null,
  sanitisedScene: string,
): MascotColourWorld {
  if (preset) {
    return {
      coreColours: dna.colourPalette,
      ...SCENE_PRESETS[preset].palette,
      paletteKey: preset,
      source: "preset",
    };
  }

  const derived = deriveFreeTextPalette(sanitisedScene);
  return {
    coreColours: dna.colourPalette,
    ...derived.palette,
    paletteKey: derived.paletteKey,
    source: "derived",
  };
}

function formatCharacterSection(dna: MascotVisualDNA): string {
  return [
    `CHARACTER (locked — do not alter): ${dna.characterDescription}.`,
    "The mascot is the sole character in the image — no sidekicks, no crowd,",
    "no cameo characters from other projects.",
  ].join(" ");
}

function formatAssociationsSection(associations: readonly string[]): string {
  return [
    `ASSOCIATIONS (connected chain — no random props): ${associations.join(" → ")}.`,
    "Every object, prop, and visual effect must be caused by or clearly relate to the preceding link;",
    "remove anything that cannot be traced through this chain.",
  ].join(" ");
}

function formatColourWorldSection(colourWorld: MascotColourWorld): string {
  return [
    `COLOUR WORLD: core colours (locked across every scene) — ${colourWorld.coreColours}.`,
    `Environmental colours — ${colourWorld.environmentalColours}.`,
    `Contrast colours — ${colourWorld.contrastColours}.`,
    `Accent colours — ${colourWorld.accentColours}.`,
    "Do not recolour the mascot to match the environment; core colours belong to the mascot and its locked signature props.",
  ].join(" ");
}

function formatVisualDnaSection(dna: MascotVisualDNA, project: MascotProject): string {
  const ticker = project.ticker.trim().replace(/^\$/, "").toUpperCase();
  return [
    `VISUAL DNA: core colour palette — ${dna.colourPalette}. Signature props — ${dna.signatureProps}.`,
    `Art style — ${dna.artStyle}.`,
    `PROJECT REFERENCE: only ${project.name} ($${ticker}) may appear anywhere in the scene`,
    "(signage, screens, clothing, chat bubbles). Do not depict any other project's name, ticker, or logo.",
    "Do not depict seed phrases, private keys, or real wallet UI chrome.",
  ].join(" ");
}

/**
 * Assembles a full image-generation prompt for the mascot, following the
 * IDEA → ASSOCIATIONS → STORY → MEME → COLOUR WORLD → EXAGGERATION → DETAILS
 * formula from docs/mascot-image-generation.md. Locked character DNA frames
 * the creative formula and remains identical across every scene.
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
  const ticker = project.ticker.trim().replace(/^\$/, "").toUpperCase();

  const expansion = preset
    ? SCENE_PRESETS[preset].expansion
    : expandFreeTextScene(sanitisedScene, ticker);
  const colourWorld = resolveColourWorld(dna, preset, sanitisedScene);

  const sections = [
    formatCharacterSection(dna),
    `IDEA: ${expansion.idea}.`,
    formatAssociationsSection(expansion.associations),
    `STORY: ${expansion.story}.`,
    `MEME: ${expansion.meme}.`,
    formatColourWorldSection(colourWorld),
    `EXAGGERATION: ${expansion.exaggeration}.`,
    `DETAILS: ${expansion.details}.`,
    formatVisualDnaSection(dna, project),
  ];

  return {
    prompt: sections.join("\n\n"),
    sceneKey: preset ?? "custom",
    sanitisedScene,
    strippedTerms,
    colourWorld,
  };
}

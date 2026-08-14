# Mascot image-generation engine spec — v2

Scope: this document specifies the **prompt-construction mechanism** behind
the AI Social Studio's "Drop your mascot" feature (see `lib/plans-section.ts`
`PLAN_CALLOUTS["Drop Your Mascot"]` and the `"Drop your mascot"` Pro bullet in
`lib/launch-paths.ts`). It is implemented by
`lib/server/mascot-prompt-builder.ts`.

It does **not** cover calling an image-generation API. There is no image
pipeline wired up yet. The builder is a pure prompt layer that accepts
`(mascotVisualDNA, sceneInput, project)` and returns a finished prompt plus
scene and colour-world metadata.

## What v2 changes

A generic prompt such as "put my mascot at the beach" usually creates a
literal stock illustration. The model adds disconnected props, floods every
scene with the mascot's brand colours, and gradually changes the character
between images.

V2 separates two jobs:

1. **Identity remains locked.** The mascot's description, core colours,
   signature props, and art style are repeated unchanged in every prompt.
2. **The scene is designed.** The scene develops through a connected chain
   of ideas, a cause-and-effect story, a meme, a four-layer colour world,
   controlled exaggeration, and meaningful details.

The result should feel inventive without becoming random. Creativity comes
from following associations further than the obvious first idea, while every
object still has a reason to exist.

## The v2 formula

The creative part of every prompt is assembled in this order:

```text
IDEA → ASSOCIATIONS → STORY → MEME → COLOUR WORLD → EXAGGERATION → DETAILS
```

The formula is wrapped by two locked identity sections:

- **CHARACTER** comes before the formula and states that the mascot is the
  sole character.
- **VISUAL DNA** comes after the formula and repeats the mascot's core
  colours, signature props, art style, and project-name/ticker restrictions.

| Part | Purpose | Varies by scene? |
| --- | --- | --- |
| **IDEA** | Reduces the scene to one clear action, decision, or consequence rather than a static pose. | Yes |
| **ASSOCIATIONS** | Builds a connected chain where each object or visual beat follows from the previous one. | Yes |
| **STORY** | Turns the association chain into a readable before/now/next moment. | Yes |
| **MEME** | Finds the crypto-native contradiction, punchline, or social observation. | Yes |
| **COLOUR WORLD** | Combines locked mascot colours with scene-specific environment, contrast, and accent palettes. | Partly: core locked; other layers vary |
| **EXAGGERATION** | Pushes one or two important beats far beyond reality without changing the mascot's identity. | Yes |
| **DETAILS** | Adds small connected evidence and one own-project easter egg worth zooming in for. | Yes |

## The full ten-step process

### 1. Lock the mascot and project boundary

Read the mascot visual DNA once:

- character/species/type and distinguishing features;
- **core colours** belonging to the mascot or brand;
- signature props and accessories;
- rendering/art style.

Treat those values as constants. A scene may change lighting around the
mascot, but it must not redesign, recolour, or replace the mascot. The only
project identity allowed in the prompt is the caller's own `project.name`
and `project.ticker`.

### 2. Extract one clear idea

Turn the scene direction into an action, decision, or consequence. Avoid
"mascot standing in a casino". Prefer "mascot celebrating an electronic
blackjack win while ignoring its own red chart alert".

The idea should answer: **what is happening at this exact second?**

### 3. Build a connected association chain

Expand the idea one link at a time. Every new object must be caused by,
needed by, or visually related to the previous link.

Example for `beach`:

```text
own-project chart spikes
→ mascot decides to leave immediately
→ rushed trip leaves the signature bag half-open
→ sunscreen and charger spill from that bag
→ mascot claims a beach chair before unpacking
```

This is the **connected-association rule**:

> No random props. If an object cannot be traced back through the chain, it
> does not belong in the image.

A surfboard, parrot, treasure chest, or sports car must not appear merely
because it looks colourful. The prompt should use fewer objects with stronger
relationships rather than many unrelated decorations.

### 4. Convert the chain into a story

Use the connected objects as evidence of what happened before the frame and
what may happen next. Fresh footprints imply a rushed arrival. A still-lit
phone implies the alert is recent. Confetti still in the air implies the
celebration has only just started.

The story should be visible in the image. It should not rely on a paragraph
of narration inside the artwork.

### 5. Find the meme

Look for a contradiction or shared crypto behaviour:

- touching grass while still checking the chart;
- winning at a casino while losing in the market;
- treating one green candle like a championship;
- taking "to the moon" literally while the GAS gauge is nearly empty;
- presenting meme-coin chaos like a corporate earnings call.

The meme is not a random slogan pasted on top. It should emerge from the
pose, props, timing, and story.

### 6. Resolve the four-layer colour world

Keep the mascot's core colours fixed, then choose three scene-specific
layers: environmental, contrast, and accent colours. The exact system is
defined in the next section.

Colour is part of scene design, not a global filter. A brand-orange mascot
can remain brand orange on a turquoise beach, in a graphite trading room, or
against an indigo space scene.

### 7. Protect subject/environment separation

Compare the locked core colours with the environment. Choose light/dark and
warm/cool contrast values that preserve a clear silhouette.

Examples:

- a bright warm mascot on a tropical background may need deep navy shadow
  shapes and crisp off-white sunlight;
- a dark mascot in a trading room may need cool-white monitor light and cyan
  edge light;
- a pale mascot in snow may need midnight shadows and warm reflected light.

Contrast colours do not replace core colours. They are lighting, edges,
shadows, nearby surfaces, or backdrop values that make the subject readable.

### 8. Exaggerate one dominant beat

Push one or two elements beyond reality:

- a chart candle nearly fills the monitor;
- a moon appears impossibly large;
- a tiny chair strains under the mascot;
- confetti follows the same arc as a rising price chart;
- a reflected candle stretches across an entire rain puddle.

Do not exaggerate everything. One clear extreme is funnier and easier to
read than a frame where every object competes for attention.

### 9. Add connected details and one easter egg

Details must either:

- prove the story;
- continue the association chain;
- support the meme;
- clarify the colour world;
- or reference the user's own project.

A sticky note saying "don't panic sell" belongs on the trading monitor
because it follows earlier mistakes in the story. A project flag belongs on
a sandcastle because it connects the beach environment to the user's own
identity. An unrelated luxury watch does not belong unless the story created
a reason for it.

### 10. Assemble and validate

Assemble the final prompt in the v2 formula order, wrapped by locked
CHARACTER and VISUAL DNA sections. Before returning it, enforce all
non-negotiable rules:

- the mascot is the sole character;
- core mascot colours are unchanged;
- every scene object follows the association chain;
- only the user's own project name/ticker may appear;
- no real seed phrase, private key, or wallet UI chrome appears;
- the scene has environment, contrast, and accent palette guidance;
- free-text scenes receive a derived palette rather than falling back to one
  universal brand-colour background.

## The four-layer colour system

### 1. Core colours — locked subject/brand colours

Source: `MascotVisualDNA.colourPalette`.

These colours belong to the mascot, its clothing, markings, and locked
signature props. They remain consistent across every image. They are not a
request to paint the entire scene in the same palette.

### 2. Environmental colours — the world around the mascot

These colours define large surfaces and atmosphere: sky, water, walls,
roads, furniture, terrain, shadow mass, and ambient light.

Environmental colours should usually sit slightly below the mascot in
saturation or visual priority. They change with the scene.

### 3. Contrast colours — separation and readability

These are selected after comparing the core colours with the environment.
They provide warm/cool or light/dark separation through rim light, shadow,
reflected light, surfaces, and negative space.

Contrast colours exist to preserve the mascot's silhouette. They do not
recolour the mascot.

### 4. Accent colours — small functional energy

These are the most saturated scene colours and should be limited to small,
meaningful areas:

- lights;
- signs;
- screens;
- chart states;
- reflections;
- sparks, thrusters, confetti, or other effects;
- functional warnings or status indicators.

Accent colours should be connected to a real scene source. Do not scatter
neon colours randomly across unrelated props.

## Example palettes by scene family

The mascot's core palette is always supplied separately and remains locked.
The examples below describe the other three layers.

### Tropical / beach

- **Environmental:** sun-bleached sand, turquoise water, pale aqua sky,
  warm coral shadows.
- **Contrast:** deep navy shadow shapes and crisp off-white sunlight.
- **Accent:** sunset coral, reflective cyan, and a small functional lime on
  the phone/chart.

### Celebration / nightlife

- **Environmental:** midnight navy, smoked black, deep plum, muted gold.
- **Contrast:** champagne cream highlights and cool cyan rim light.
- **Accent:** magenta neon, electric blue, jackpot gold, brief white flash.

### Technology / trading

- **Environmental:** charcoal, graphite, dark slate, desaturated navy.
- **Contrast:** cool-white monitor light and pale cyan edge light.
- **Accent:** chart green, restrained alert red, amber status lights, cyan
  screen glow.

### Space

- **Environmental:** near-black, deep indigo, violet nebula, cold blue
  planetary shadows.
- **Contrast:** starlight white and silver-blue edge light.
- **Accent:** electric cyan instrumentation, ultraviolet effects, meteor
  orange, restrained neon-green navigation data.

## Standard scene-chip mapping

`lib/server/mascot-prompt-builder.ts` contains hand-authored creative and
palette mappings for:

| Scene chip | Colour family |
| --- | --- |
| `beach` | tropical daylight |
| `celebrating` | celebration/nightlife |
| `trading` | technology/trading |
| `space` | cosmic/space |
| `city streets` | wet neon urban night |
| `office` | restrained corporate interior |
| `casino` | black, burgundy, emerald, ivory, gold |
| `nature` | forest, earth, sky, natural highlights |

Each preset supplies:

- one clear idea;
- a concrete connected-association chain;
- a visible story;
- a crypto-native meme;
- environmental, contrast, and accent palettes;
- one controlled exaggeration;
- connected details and an own-project easter egg.

## Free-text scene palette derivation

Free text remains `sceneKey: "custom"`, but it does not receive a generic
one-colour treatment.

The builder first checks scene language for known families. For example:

- `party on a rooftop` derives the celebration/nightlife palette;
- `coding in an arcade` derives the technology/trading palette;
- `solo hike through a forest` derives the nature palette;
- `at the gym deadlifting` derives an industrial palette using concrete,
  rubber, steel, practical white light, and functional equipment accents;
- snow, desert/heat, food/hospitality, and water/storm language have their
  own derived palettes.

When no family matches, the prompt derives colours directly from the scene:

- environmental colours come from the natural local materials and light
  implied by the text;
- they stay one saturation step below the locked mascot colours;
- contrast uses an opposite-temperature light/dark value chosen around the
  mascot's core palette;
- accents are limited to one or two colours from connected lights, signs,
  effects, screens, or materials already justified by the association chain.

The result metadata reports `colourWorld.source: "derived"` and the selected
palette family.

## Guardrails — non-negotiable

- **The mascot is always the sole character.** No sidekicks, crowds, dealers,
  friends, reflected characters, or cameo mascots from other projects.
- **Only the user's own project name/ticker may appear.** The builder strips
  foreign `$TICKER` cashtags and a curated set of other-project names from
  free-text input before assembly.
- **Core colours stay locked.** Environmental palettes and lighting may vary;
  the mascot itself must not be recoloured to match the scene.
- **No random props.** Every object, effect, sign, or screen must connect to
  the preceding association or to the visible story.
- **No seed phrases, private keys, or real wallet UI chrome.** Wallet and
  market references remain illustrative and generic.
- **No other project logo or identity.** The project reference section names
  only the caller's own `project.name` and normalised `$TICKER`.

## Implementation notes

`lib/server/mascot-prompt-builder.ts` implements this document as
`buildMascotImagePrompt(dna, sceneInput, project)`:

- `dna` (`MascotVisualDNA`) stores the locked character description, core
  colour palette, signature props, and art style.
- `sceneInput` matches the eight standard chips exactly, case-insensitively,
  or is treated as free text.
- preset scenes use hand-authored expansions and palettes;
- free text uses the generic connected-association template and a keyword or
  scene-derived palette;
- `project` (`{ name, ticker }`) is the only project identity injected;
- the function remains pure and synchronous with no network or API calls;
- the result keeps the existing `prompt`, `sceneKey`, `sanitisedScene`, and
  `strippedTerms` fields and adds `colourWorld` metadata containing:
  `coreColours`, `environmentalColours`, `contrastColours`, `accentColours`,
  `paletteKey`, and `source`.

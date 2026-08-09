# Mascot image-generation engine spec

Scope: this document specifies the **prompt-construction mechanism** behind
the AI Social Studio's "Drop your mascot" feature (see `lib/plans-section.ts`
`PLAN_CALLOUTS["Drop Your Mascot"]` and the `"Drop your mascot"` Pro bullet in
`lib/launch-paths.ts`). It is implemented by
`lib/server/mascot-prompt-builder.ts`.

It does **not** cover calling an image-generation API. There is no image
pipeline wired up yet — this spec and its implementation are the prompt
layer that a future generation pipeline will call with
`(mascotVisualDNA, sceneInput, project)` and receive back a finished prompt
string.

## Why this exists

A generic "put my mascot at the beach" prompt produces generic art: a
character standing on sand holding a random prop. It doesn't read as *crypto
meme content*, and repeated generations drift — the character's proportions,
colours, or props subtly change each time, which breaks community
recognition (the whole point of "Drop Your Mascot").

The mechanism below fixes both problems:

1. The character's **visual DNA is locked** and repeated verbatim into every
   prompt, so the mascot looks like the same character across every scene.
2. The **scene is never taken literally** — it is run through a
   meme-interpretation process that grounds it in crypto culture, adds a
   joke, a mini-story, and one hidden detail, so the output reads as a meme
   a crypto-native community would actually share, not a stock illustration.

## The formula

Every generated prompt is assembled from seven parts, always in this order:

```
CHARACTER + SITUATION + CRYPTO CULTURE + MEME/JOKE + MINI-STORY + HIDDEN DETAILS + VISUAL DNA
```

| Part | Purpose | Varies per scene? |
| --- | --- | --- |
| **CHARACTER** | Restates the mascot's identity and states it is the *sole* character in frame. | No — locked |
| **SITUATION** | The scene, reframed as an action/moment rather than a static pose. | Yes |
| **CRYPTO CULTURE** | Grounds the situation in trading/degen/on-chain culture and slang. | Yes |
| **MEME/JOKE** | The specific punchline or comedic beat the image stages. | Yes |
| **MINI-STORY** | An implied before/after — evidence of what just happened or is about to. | Yes |
| **HIDDEN DETAILS** | One small background easter egg worth zooming in for. | Yes |
| **VISUAL DNA** | Colour palette, signature props, and art style, restated verbatim, plus the project-name/ticker guardrail. | No — locked |

The **CHARACTER** and **VISUAL DNA** parts together are the "locked
identity" — for a given user, they are byte-for-byte identical across every
scene and every generation. Only **SITUATION** through **HIDDEN DETAILS**
change, driven by the scene input.

## The five steps

### 1. Lock identity

Take the mascot's visual DNA (extracted once from the user's uploaded
artwork — species/character type, distinguishing features, colour palette,
signature props/accessories, art/rendering style) and treat it as a
constant. It is restated in full, unabridged, in every prompt. Nothing about
the character's appearance is ever inferred from the scene — the beach scene
does not add sunglasses unless sunglasses are already part of the locked
DNA. This is what makes the character recognisable as *the same character*
across dozens of generated images.

### 2. Interpret environment as meme

The scene input (a Studio chip like "beach", "trading", "casino", or free
text the user types) is never rendered literally. It is treated as a seed to
interpret through a meme lens: what does this environment *mean* in crypto
culture, and what's the funniest, most shareable way to stage the mascot in
it? "Beach" doesn't mean sand and an umbrella — it means "cashed out and
touching grass for the first time since the pump," which is a completely
different image brief.

### 3. Association-expansion

From the meme interpretation, pull in concrete crypto-culture references:
trading slang (diamond hands, paper hands, degen, ape in, rug, moon, HODL,
liquidity pool, gas fees, whale, rekt), visual motifs (candlestick charts,
wallet apps, Telegram/X notification bubbles, seed-phrase jokes handled
*without* ever depicting a real seed phrase — see Standing Rule 4 in
`CLAUDE.md`), and physical staging that a crypto-native audience recognises
instantly. This is what turns "mascot at a casino" into "mascot loudly
celebrating a blackjack win while a tiny chart on a nearby screen is deep
red" — the joke is the contrast.

### 4. Mini-stories

Every generated image implies a moment just before or just after the one
shown — evidence in the props, pose, or background rather than narration.
A pile of empty energy drink cans next to a trading desk implies an
all-nighter. A cracked phone screen implies a slammed-down reaction to a
dip. This is what makes a still image read as a *story* instead of a pose.

### 5. Push past the obvious

The first idea for any scene is usually the most generic one everyone would
generate — reject it. Add a hidden detail that rewards a second look: a
background sign with an in-joke, a barely-visible chart trending an
unexpected direction, a second character's reaction glimpsed in a mirror or
screen. This is the "hidden details" part of the formula, and it is what
makes an image worth zooming into and sharing rather than scrolling past.

## Guardrails (non-negotiable)

- **The mascot is always the sole character.** No sidekicks, no crowds, no
  cameo characters from other projects.
- **Only the user's own project name/ticker may appear** anywhere in the
  generated scene (signage, screens, clothing, chat bubbles). The prompt
  builder strips `$TICKER`-style cashtags and well-known other-project names
  out of free-text scene input before they ever reach the assembled prompt,
  and never injects any ticker or name other than the caller's own
  `project.name` / `project.ticker`.
- **No seed phrases, private keys, or real wallet UI chrome** — consistent
  with the platform's non-custodial stance (`CLAUDE.md` rule 4). Wallet/UI
  references stay illustrative and generic.

## Worked examples

The following use an example locked identity:

```
characterDescription: "a stocky orange-hoodie wolf mascot with an oversized
  grin, small round sunglasses pushed up on its forehead, and a bushy
  striped tail"
colourPalette: "burnt orange, cream, charcoal outlines"
signatureProps: "a battered green backpack covered in pin badges"
artStyle: "flat vector meme illustration, bold black outlines, halftone
  shading"
```
Project: `name: "Wolfpack"`, `ticker: "WOLF"`.

### Example A — scene chip: "beach"

- **Situation:** the mascot sprawled in a beach chair that's visibly too
  small for it, phone held at arm's length, mid-selfie.
- **Crypto culture:** a cocktail umbrella stuck in a coconut is replaced by
  a tiny printed candlestick chart, all green.
- **Meme/joke:** the grin is *too* wide for a normal vacation photo — this
  is "I sold the top" energy, not "I'm relaxing" energy.
- **Mini-story:** the backpack is half-buried in sand next to it, unzipped,
  spilling out sunscreen and a laptop charger — it left in a hurry to cash
  out and get here.
- **Hidden details:** a tiny sandcastle in the background has a hand-drawn
  $WOLF flag planted on top.

### Example B — scene chip: "trading"

- **Situation:** the mascot hunched over a triple-monitor desk setup at
  night, one paw frozen over a mouse.
- **Crypto culture:** the monitors show wallet balances and a chart with a
  vertical green candle; a half-drunk energy drink sits next to a stack of
  empty cans.
- **Meme/joke:** the mascot's sunglasses have fallen fully off its forehead
  onto the desk — the "diamond hands" reaction to watching a chart spike,
  frozen mid-disbelief.
- **Mini-story:** a phone lies face-down next to the keyboard, screen
  cracked — it got put down hard a few candles ago.
- **Hidden details:** a sticky note on the monitor bezel just says "don't
  panic sell" in the mascot's own messy handwriting.

### Example C — scene chip: "casino"

- **Situation:** the mascot mid-cheer at a blackjack table, one paw thrown
  in the air, chips scattering.
- **Crypto culture:** the chips are stamped with a stylised "W" (echoing the
  ticker without spelling it out on every chip); a small TV in the
  background shows a red candlestick chart nobody at the table is watching.
- **Meme/joke:** the contrast between "winning big at the table" and "red
  chart nobody's looking at" is the whole joke — the mascot is up in the
  wrong game.
- **Mini-story:** an empty seat next to the mascot has a drink going flat
  and a phone left face-up, notifications piling up — a friend who left
  mid-session to go check something.
- **Hidden details:** the dealer's name tag, barely legible, reads "RUG"
  — a background gag, never called out in the main action.

### Example D — free-text scene: "at the gym"

The mascot's locked identity is unchanged. The scene text is run through the
same five steps even though it isn't a preset chip:

- **Situation:** the mascot mid-deadlift, face contorted with effort, in a
  half-empty gym.
- **Crypto culture:** the weight plates are printed like giant coins; the
  gym's wall-mounted TV shows a portfolio chart instead of the news.
- **Meme/joke:** the bar is loaded comically unevenly — one side stacked
  with tiny plates, the other with one enormous plate — "leverage" made
  literal.
- **Mini-story:** a phone propped against a water bottle is mid-notification
  spam, screen lighting up, ignored mid-lift.
- **Hidden details:** a "no crying in the gym" sign in the background has
  had "crying" crossed out and "panic selling" written underneath in marker.

## Implementation notes

`lib/server/mascot-prompt-builder.ts` implements this spec as
`buildMascotImagePrompt(dna, sceneInput, project)`:

- `dna` (`MascotVisualDNA`) holds the four locked-identity fields
  (`characterDescription`, `colourPalette`, `signatureProps`, `artStyle`).
  These are restated verbatim in the `CHARACTER` and `VISUAL DNA` sections of
  every prompt for a given user, regardless of scene.
- `sceneInput` is either one of the Studio chip presets (`"beach"`,
  `"trading"`, `"casino"`) or free text. Presets use the hand-authored
  expansions above (Examples A–C); free text is run through a generic
  five-step expansion template (Example D's shape) that still applies the
  formula without hardcoding a specific joke, since the space of free text
  is unbounded.
- `project` (`{ name, ticker }`) is the only project identity ever injected
  into the prompt. Before assembly, free-text scene input is sanitised:
  `$TICKER`-style cashtags that don't match the caller's own ticker, and a
  curated list of well-known other crypto project names, are stripped out.
  The function reports what it stripped so callers can log/audit it.
- The function is pure and synchronous — no network calls, no API wiring.
  It returns the assembled prompt string plus metadata (`sceneKey`,
  sanitised scene text, stripped terms) for the future image pipeline and
  for tests.

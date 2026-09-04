# Hoodlums Token Page v2 — exact style spec
Every literal value from the design file. Copy these verbatim — the premium look comes almost entirely from the gradients, inset highlights and layered shadows below; flat fills are what makes the live build look off.

## 1 · Page canvas
- Background: `#0a0b09` with two ambient glows layered over it:
  `radial-gradient(1100px 620px at 30% -8%, rgba(198,245,62,0.07), transparent 62%), radial-gradient(900px 600px at 90% 4%, rgba(198,245,62,0.04), transparent 60%), #0a0b09`
- Page padding: `22px 26px 40px` · column gap between header band and body: `18px` · gap between the 3 columns: `18px`
- Left column width: `340px` fixed · centre: `flex:1; min-width:620px` · page `min-width:1120px`
- Body text: Inter · headings/figures: 'Archivo Black' (weight 400) · labels/numbers: 'IBM Plex Mono'
- Text colours: primary `#f4f7f1` · body `#d9dfd6` · value `#e6ebe4` · secondary `#c3c9c4` · sub `#a8aaa9` · label `#8d918c` · faint `#6f746e` · disabled `#4a4f49`
- Accents: lime `#c6f53e` · red `#e2564b` · mint `#91f0b6` (badges only, never buttons) · text-on-lime `#071008`

## 2 · THE panel treatment (every major card)
This is the single most important recipe. Applied to: header band, swap, stats, creator fees, chart, lower-tabs panel.
```
border: 1px solid rgba(255,255,255,0.09);
border-radius: 22px;
background: linear-gradient(180deg, rgba(24,28,25,0.99) 0%, rgba(15,18,16,0.99) 34%, rgba(9,11,10,0.99) 100%);
box-shadow: 0 1px 0 0 rgba(255,255,255,0.07) inset,   /* hairline top highlight */
            0 0 0 1px rgba(0,0,0,0.5),                 /* black ring outside the border */
            0 30px 70px -24px rgba(0,0,0,0.8);         /* deep drop shadow */
```
NOT a flat `rgba(18,21,19,0.99)` fill — the 3-stop gradient (lighter at top, near-black at bottom) is what reads as machined glass.

### Panel header wash (chart header, stats header, tab rail)
The strip at the top of a panel gets a faint lime wash fading to nothing:
`background: linear-gradient(180deg, rgba(198,245,62,0.045), transparent)` (stats/tab rail use `0.04`), plus `border-bottom: 1px solid rgba(255,255,255,0.07)`.

### Inset wells (inputs, recessed areas — YOU PAY / YOU RECEIVE, holder-breakdown dropdown)
```
border: 1px solid rgba(255,255,255,0.09);
border-radius: 14px;   /* breakdown dropdown: 12px */
background: linear-gradient(180deg, rgba(0,0,0,0.38), rgba(255,255,255,0.022)), #0a0f0c;
box-shadow: 0 2px 6px 0 rgba(0,0,0,0.5) inset;
```
Dark at top → subtle light at bottom = recessed. Padding `13px 14px`.

### Raised micro-buttons (back button, swap-arrow bead)
```
border: 1px solid rgba(255,255,255,0.1);
background: linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.02)), #111713;
box-shadow: 0 1px 0 0 rgba(255,255,255,0.07) inset, 0 6px 16px -10px rgba(0,0,0,0.85);
```
Back button 32×32, radius 9px, icon `#c3c9c4`. Swap bead 30×30, radius 9px, icon lime, `margin:-6px 0; z-index:2`.

## 3 · Header band
- Panel treatment above, padding `10px 16px`, content gap `16px`
- Art tile: 50×50, radius 11, `border:1px dashed rgba(198,245,62,0.3)`, bg `linear-gradient(180deg, rgba(198,245,62,0.05), rgba(0,0,0,0.3)), #0a0f0c`, "DROP ART" 6.5px mono `#6f746e`
- Name: Archivo Black 17px, `letter-spacing:-0.01em` · ticker: mono 700 12px `#8d918c`
- LIVE pill: padding `4px 9px`, radius 999, `border:1px solid rgba(198,245,62,0.3)`, bg `linear-gradient(180deg, rgba(198,245,62,0.14), rgba(198,245,62,0.03))`, text mono 700 9px lime, 6px lime dot pulsing (opacity .35→1, 1.9s)
- Meta row: mono 600 9px `#8d918c`, values `#c3c9c4`, 3px dot separators `#4a4f49`
- RHC chip: padding `3px 8px`, radius 999, `border:1px solid rgba(145,240,182,0.32)`, bg `rgba(145,240,182,0.08)`, text `#91f0b6`
- Graduation block: `max-width:360px`. Track: height 5px, radius 99, bg `linear-gradient(180deg, rgba(0,0,0,0.4), rgba(255,255,255,0.02))`, `box-shadow:0 2px 5px 0 rgba(0,0,0,0.5) inset`. Fill: `linear-gradient(90deg, rgba(198,245,62,0.55), #c6f53e)` + glow `0 0 14px rgba(198,245,62,0.5)`. Label mono 700 9.5px lime; "remaining" line mono 600 8.5px `#6f746e`
- Big figure: Archivo Black 21px `#f4f7f1` · mode label mono 700 8px `#8d918c`, tracking 0.12em
- Change pill (+11.92%): lime text on lime-tinted pill (red variant mirrors with #e2564b)
- Link chips: min-height 26, padding `0 10px`, radius 7, `border:1px solid rgba(255,255,255,0.09)`, bg `rgba(255,255,255,0.035)`, mono 600 9.5px uppercase tracking 0.08em, `#a8aaa9`. Disabled Pool: colour `#5f645e`, `opacity:.55`, note "after graduation" mono 600 7.5px `#6f746e`

## 4 · Swap panel (340px col)
- Panel treatment, padding 16, stack gap 13
- Buy/Sell segmented track: `padding:3px; border-radius:999px; border:1px solid rgba(255,255,255,0.08); background:linear-gradient(180deg, rgba(0,0,0,0.4), rgba(255,255,255,0.02)); box-shadow:0 2px 6px 0 rgba(0,0,0,0.5) inset`
- Segment active: `min-height:34px; radius 999; background:#c6f53e; color:#071008; border:1px solid rgba(198,245,62,0.5); font:800 12px Inter`. Inactive: transparent, `#8d918c`
- Wallet pill: min-height 34, padding `0 12px`, radius 999, `border:1px solid rgba(145,240,182,0.3)`, bg `rgba(145,240,182,0.07)`, mono 700 10.5px `#91f0b6`, 6px mint dot
- Amount figures: Archivo Black 26px `#f4f7f1`. Field labels mono 700 9px tracking 0.13em `#8d918c`; BAL mono 600 9.5px `#6f746e`
- Unit chip (ETH): `padding:6px 11px; radius 8; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.09)`; mono 800 11px `#e6ebe4`. Receive chip (HOODS): `background:rgba(198,245,62,0.1); border:1px solid rgba(198,245,62,0.3)`; lime text
- Presets (0.1/0.5/1/MAX): `flex:1; min-height:30px; radius 8; mono 700 10.5px`. Idle: `border rgba(255,255,255,0.09); background:linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.012)); color:#a8aaa9`. Selected: `border rgba(198,245,62,0.5); background:linear-gradient(180deg, rgba(198,245,62,0.2), rgba(198,245,62,0.05)); color:#c6f53e`
- Slippage chips: min-height 28, padding `0 12px`, radius 999, same idle/selected recipe (idle bg transparent)
- **CTA (rule: solid lime, never a gradient):** `min-height:50px; border-radius:999px; background:#c6f53e; color:#071008; font:800 14.5px Inter; box-shadow:0 14px 34px -12px rgba(198,245,62,0.5)`
- Fee note: mono 600 10px `#6f746e`, centred

## 5 · Stats / Audit panel
- Panel treatment. Header row: padding `11px 14px`, bottom border `rgba(255,255,255,0.07)`, lime wash `linear-gradient(180deg, rgba(198,245,62,0.04), transparent)`
- Stats/Audit segmented: same inset track as Buy/Sell but radius 10
- Chips (5M/1H/24H, chart TFs, Stats/Audit segments) — the shared `chip()` recipe:
  - Base: `min-height:28px; padding:0 12px; border-radius:8px; transition:all .14s; font:700 10.5px mono; letter-spacing:0.07em`
  - Idle: border transparent, bg transparent, `#8d918c`
  - Active: `border:1px solid rgba(198,245,62,0.5); background:linear-gradient(180deg, rgba(198,245,62,0.2), rgba(198,245,62,0.05)); box-shadow:0 1px 0 0 rgba(198,245,62,0.22) inset, 0 6px 16px -8px rgba(198,245,62,0.5); text-shadow:0 0 12px rgba(198,245,62,0.45); color:#c6f53e`
- Paired rows: padding `11px 0`, divider `rgba(255,255,255,0.055)`. Keys mono 700 8.5px tracking 0.12em `#8d918c`; values mono 700 13px (lime / red / `#e6ebe4`)
- Split bars: height 3, radius 99, track `rgba(255,255,255,0.05)`, 3px gap, lime left / red right (`opacity:.85`)
- Holder breakdown: inset-well recipe (radius 12, shadow `0 2px 6px 0 rgba(0,0,0,0.45) inset`), header padding `11px 13px`, rows `10px 0`, dividers `rgba(255,255,255,0.05)`
- Audit rows: padding `10px 12px`, radius 11, `border rgba(255,255,255,0.06)`, bg `linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.008))`. Check: 20px circle, `border rgba(198,245,62,0.4)`, bg `rgba(198,245,62,0.1)`, lime tick stroke 2.6

## 6 · Creator fees
- Panel treatment. Label mono 700 9.5px tracking 0.14em; figure mono 700 14px lime
- Withdraw button: `min-height:42px; radius 999; background:#c6f53e; color:#071008; font:800 12.5px Inter` — solid lime, no gradient

## 7 · Chart panel
- Panel treatment; header padding `16px 20px 12px` with the `0.045` lime wash
- Pair label mono 700 11px tracking 0.13em `#c3c9c4`; inline price mono `#6f746e`
- TF chips: shared chip recipe (5M 15M 1H 6H 1D ALL)
- Grid lines: horizontal `rgba(255,255,255,0.045)`, vertical `rgba(255,255,255,0.035)`, 1px
- Candles: lime `#c6f53e` up / `#e2564b` down; body width 50% of slot; wick 1px, opacity .9
- MA20 lime / MA50 white polylines
- Last-price line: `repeating-linear-gradient(90deg, #c6f53e 0 6px, transparent 6px 12px)`, opacity .6. Axis tag: lime bg, `#071008` text, mono 700 9.5px, padding `4px 6px`, radius 5
- Crosshair: dashed `rgba(255,255,255,0.35)` 4px on / 4px off, both axes
- Axis gutter: left border `rgba(255,255,255,0.07)`, bg `linear-gradient(180deg, rgba(0,0,0,0.3), rgba(255,255,255,0.012))`, labels mono 600 9.5px `#6f746e`
- Tooltip rows: keys `#8d918c`, values mono 700 11px `#e6ebe4`, change % lime/red

## 8 · Lower tabs (Recent trades · Holders · Hoodchat · About)
- Panel treatment, `min-height:363px`. Tab rail: `padding:10px 14px 0`, bottom border `rgba(255,255,255,0.07)`, lime wash 0.04, `gap:2px`
- Tab button: `min-height:38px; padding:0 16px; border-radius:10px 10px 0 0; font:700 11.5px Inter; border-bottom:2px solid`
  - Active: underline `#c6f53e`, bg `linear-gradient(180deg, rgba(198,245,62,0.16), rgba(198,245,62,0.02))`, text lime
  - Idle: underline transparent, bg transparent, `#8d918c`
- Trade rows: BUY lime ▲ / SELL red ▼; wallets mono; ETH value coloured by side
- Badges: DEV = `border rgba(198,245,62,0.4); bg rgba(198,245,62,0.1); lime` · HOLDER = `border rgba(145,240,182,0.32); bg rgba(145,240,182,0.07); #91f0b6` — mono 800 8px tracking 0.1em, padding `2px 7px`, radius 99
- Chat composer: pill well `border rgba(255,255,255,0.07); radius 999; bg rgba(255,255,255,0.02); padding 6px 6px 6px 16px`; Send = solid lime pill, min-height 34, padding `0 18px`, font 800 12px

## 9 · Screenshot deltas (your live build vs this spec)
1. **Panels are flat** — missing the 3-stop gradient + inset highlight + black ring + deep shadow (§2). Biggest single difference.
2. **Buy CTA is a lime→dark gradient** — must be solid `#c6f53e` with `#071008` text and the lime drop shadow (§4; site-wide rule).
3. **No lime header washes** on chart/stats/tab rails (§2).
4. **Inputs are flat boxes** — use the recessed inset-well recipe (§2).
5. **Active chips lack the glow** — border/tint/inset/glow/text-shadow stack (§5).
6. Panel radius should be 22px on major cards; chips 8px; wells 14px; pills 999px.

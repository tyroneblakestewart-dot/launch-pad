# Hoodlums Social Studio — tab & panel style spec
Exact literal values from `Hoodlums Social Studio.dc.html`. Copy verbatim.

## 1 · Shell panel (the big studio surface)
```
border: 1px solid rgba(255,255,255,0.09);
border-radius: 26px;
background: linear-gradient(180deg, rgba(24,28,25,0.99) 0%, rgba(15,18,16,0.99) 34%, rgba(9,11,10,0.99) 100%);
box-shadow: 0 1px 0 0 rgba(255,255,255,0.07) inset,   /* hairline top highlight */
            0 0 0 1px rgba(0,0,0,0.5),                 /* black ring */
            0 30px 70px -24px rgba(0,0,0,0.8);         /* deep drop shadow */
```
Inner section panels (e.g. Performance) use the same recipe at **22px** radius.
Mobile frames: same border/shadow, radius 26px, flat `#030805` background.

## 2 · Tab rail (Setup · Calendar · Queue · Rules)
Rail strip:
```
padding: 8px 16px 0;
background: linear-gradient(180deg, rgba(198,245,62,0.045), transparent);  /* lime wash */
border-bottom: 1px solid rgba(255,255,255,0.09);
```
Tab button (both states):
```
border: 0;
border-radius: 12px 12px 0 0;
padding: 14px 20px 16px;
font: 800 12.5px Inter, sans-serif;
white-space: nowrap;
```
ACTIVE:
```
background: linear-gradient(180deg, rgba(198,245,62,0.2), rgba(198,245,62,0.05));
box-shadow: 0 1px 0 0 rgba(198,245,62,0.28) inset,   /* top edge highlight */
            0 3px 0 0 #c6f53e inset;                  /* 3px lime underline (inset bottom) */
color: #c6f53e;
text-shadow: 0 0 12px rgba(198,245,62,0.4);           /* soft glow */
```
INACTIVE: `background: transparent; box-shadow: none; color: #8d918c; text-shadow: none`

## 3 · Pills (mode/approval segmented — Fresh / Set up / Approve first, Autopilot / Approve first)
```
min-height: 32px; padding: 0 14px; border-radius: 999px;
font: 800 10px/1 'IBM Plex Mono', monospace; letter-spacing: 0.09em; text-transform: uppercase;
```
ON:
```
border: 1px solid rgba(198,245,62,0.5);
background: linear-gradient(180deg, rgba(198,245,62,0.2), rgba(198,245,62,0.05));
box-shadow: 0 1px 0 0 rgba(198,245,62,0.22) inset, 0 6px 18px -8px rgba(198,245,62,0.5);
text-shadow: 0 0 12px rgba(198,245,62,0.4);
color: #c6f53e;
```
OFF: `border: 1px solid transparent; background: transparent; color: #8d918c`

## 4 · Chips (mascot doing/where multi-select)
```
min-height: 36px; padding: 0 15px; border-radius: 999px;
font: 600 12.5px Inter, sans-serif;
```
ON: `border 1px solid rgba(198,245,62,0.5); background: LIME_CARD; box-shadow: 0 1px 0 0 rgba(198,245,62,0.22) inset; color: #c6f53e`
OFF: `border 1px solid rgba(255,255,255,0.09); background: CARD; box-shadow: CARD_SH; color: #c3c9c4`

## 5 · Destination toggles (X / Telegram chips on scheduled items)
```
min-height: 38px; padding: 0 16px; border-radius: 999px; gap: 8px;
font: 700 12.5px Inter, sans-serif;
```
ON: `border rgba(198,245,62,0.5); background LIME_CARD; box-shadow 0 1px 0 0 rgba(198,245,62,0.22) inset; color #c6f53e`
OFF: `border rgba(255,255,255,0.09); background CARD; box-shadow CARD_SH; color #8d918c`

Destination tag (on queue rows): min-height 26px, padding 0 11px, radius 999.
"Both": border `rgba(198,245,62,0.4)`, bg `rgba(198,245,62,0.1)`. Single: border `rgba(255,255,255,0.09)`, bg `rgba(255,255,255,0.04)`.

## 6 · Shared constants (used by everything above)
```
LINE      = rgba(255,255,255,0.09)                      /* universal border */
CARD      = linear-gradient(180deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.02) 38%, rgba(255,255,255,0.012) 100%)
CARD_SH   = 0 1px 0 0 rgba(255,255,255,0.05) inset, 0 8px 20px -12px rgba(0,0,0,0.7)
LIME_CARD = linear-gradient(180deg, rgba(198,245,62,0.15) 0%, rgba(198,245,62,0.05) 42%, rgba(198,245,62,0.02) 100%)
GHOST btn = border 1px solid LINE; background linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02));
            box-shadow 0 1px 0 0 rgba(255,255,255,0.07) inset; color #f4f7f1
LIME_BTN  = background #c6f53e; color #071008; border 0    /* solid lime, never gradient */
MONO      = 'IBM Plex Mono', monospace
```

## 7 · Mobile fixed chrome (≤1099px, from live CSS)
- Header: sticky top, z 95, min-height 72px, padding 8px 16px, bg `rgba(4,8,5,0.96)` + `backdrop-filter: blur(14px)`, bottom border `rgba(131,183,139,0.2)`; wordmark box 156px wide, image max-height 54px
- Bottom nav: fixed, `bottom: calc(16px + safe-area-inset-bottom)`, centred, `width: min(430px, 100% − 32px)`, height 62, padding 7px 10px, radius 999, border `rgba(255,255,255,0.13)`, bg `rgba(4,8,5,0.58)` + `blur(20px) saturate(145%)`, shadow `0 12px 34px rgba(0,0,0,0.38) + inset 0 1px 0 rgba(255,255,255,0.05)`
- Tab circles 46×46; active: border `rgba(198,245,62,0.34)`, bg `rgba(198,245,62,0.14)`, icon `#c6f53e`, glow `0 0 18px rgba(198,245,62,0.08)`; inactive icon `rgba(239,244,236,0.72)`; icons 23×23 stroke 1.8
- Body: `#030805`, bottom padding `calc(96px + safe-area-inset-bottom)`
- Mobile segmented tabs: centred pills using the §3 pill recipe

## 8 · Text colours
primary `#f4f7f1` · body `#d9dfd6` · secondary `#c3c9c4` · sub `#a8aaa9` · label `#8d918c` · faint `#6f746e` · lime `#c6f53e` · text-on-lime `#071008`

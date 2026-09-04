# Hoodlums Token Page v2 — data inventory

> Revised 29 Aug 2026 to match the final design (ETH-only pricing, real fee note, two link chips, two drawing tools, build states designed). The "Implementation rulings" section at the end is the backend mapping and overrides anything above it if they ever disagree.
Every dynamic value on the page, grouped by area. Format notes use: 6dp = six decimal places. "TF selector" = the 5M / 1H / 24H control on the Stats panel (the chart has its own timeframe rail). Unless stated, nothing responds to the Price/MCap toggle except the big figure itself.

---

## 1 · Header band

**Token artwork** · far left of band
- The token's image. The "DROP ART" upload affordance appears ONLY when the viewer is the creator and no image is set; everyone else sees a placeholder tile with the token's initial letter (see Build states page).
- Format: square image. Example: empty placeholder.
- TF: no · Price/MCap: no · Update: on load (changes only when creator uploads).
- No data: creator sees DROP ART; non-creator sees the initial-letter tile. Error: same.

**Token name — "HOODLUMS"** · beside artwork
- Display name the creator gave the token.
- Format: text. Example: HOODLUMS.
- TF: no · Update: on load. No data: cannot be empty (set at creation). Error: "—".

**Ticker — "$HOODS"** · beside name
- Trading symbol. Format: $ + ticker text. Example: $HOODS.
- Same behaviour as name.

**LIVE badge** · beside ticker
- Whether the token is currently tradeable on the curve.
- Format: state pill (LIVE / not shown). Example: LIVE.
- Update: live (flips on pause/graduation events). No data: hide. Error: hide.

**Holder count — "2,417 HOLDERS"** · under name
- Number of unique wallets holding the token.
- Format: count, thousands-separated, 0dp. Example: 2,417.
- TF: no · Update: live. No data: "0 HOLDERS". Error: "— HOLDERS".
- Same source as HOLDERS row in the Stats breakdown — must always match.

**Launch age — "LAUNCHED 2D AGO"** · under name
- Time since the token's creation transaction.
- Format: duration, coarse single unit (m/h/d). Example: 2D AGO.
- TF: no · Update: live (ticks over). No data: "JUST NOW". Error: "—".

**Chain badge — "RHC"** · under name
- The chain the token is deployed on.
- Format: short chain code. Example: RHC.
- Update: on load. Never empty. Error: "—".

**GRADUATION — "3.12 / 4.0 ETH · 78%"** · centre of band
- ETH raised on the bonding curve versus the target that triggers graduation.
- Format: ETH 2dp / ETH 1dp · percentage 0dp. Example: 3.12 / 4.0 ETH · 78%.
- TF: no · Update: live (moves with every buy). New token: "0.00 / 4.0 ETH · 0%", empty bar. Error: "— / 4.0 ETH", empty bar.

**Graduation bar fill** · under the graduation label
- Visual share of target raised. Format: 0–100% width. Example: 78%.
- Same behaviour as the figures above.

**Remaining line — "0.88 ETH remaining"** · under the bar
- ETH still needed to graduate.
- Format: ETH 2dp. Example: 0.88 ETH remaining.
- Update: live. New token: "4.00 ETH remaining". Error: "— ETH remaining".

**Mode label — "PRICE · TAP FOR MCAP" / "MCAP · TAP FOR PRICE"** · right side, above nothing (inline beside figure)
- Tells the user which mode the big figure is in.
- Format: fixed strings, switches with the toggle. Example: PRICE · TAP FOR MCAP.

**Big figure** · right side of band
- Current token price in ETH per token, or fully-diluted market cap in ETH when toggled. No USD exists on this chain.
- Format: price mode = ETH, six significant figures (0.0000359717 ETH); mcap mode = ETH 2dp (3.59 ETH).
- TF: no · Price/MCap: yes (this is the toggle's target) · Update: live.
- New token: price mode shows the curve's starting price; mcap its equivalent. Error: "— ETH".

**Change pill — "+11.92%"** · beside the figure
- Percent change over the chart's loaded range; green positive, red negative.
- Format: signed percentage 2dp. Example: +11.92%.
- TF: follows the CHART timeframe rail, not the Stats TF selector · Price/MCap: value is identical in both modes (mcap scales with price) · Update: live.
- New token: "0.00%". Error: "—%".

**Link chips — Contract / Pool** · under the figure
- External links: the token contract on the explorer, and the locked pool on the explorer once it exists.
- Format: URLs behind fixed labels, real addresses only.
- Update: on load. Pool is DISABLED with an "after graduation" note beneath it while the token is bonding; enabled once `liquidityPool` is set. Error: chip disabled.

---

## 2 · Swap panel (left column, top)

**Buy / Sell toggle** · top of panel
- Chooses trade direction; restyles the active side and swaps the CTA label.

**Wallet pill — "0x3990…966a"** · beside the toggle
- The connected wallet, truncated 6+4. Green dot = connected.
- Format: address. Update: on wallet connect/disconnect.
- No wallet: pill reads "Connect wallet" (disconnected state). Error: same.

**BAL — "BAL 0.0227 ETH"** · YOU PAY box header
- The connected wallet's ETH balance available to spend.
- Format: ETH 4dp. Example: 0.0227.
- Update: live (after each tx/block). No wallet: hide. Error: "BAL —".

**YOU PAY amount — "0.05"** · YOU PAY box
- User-entered ETH amount to spend (input field).
- Format: token amount, free decimals. Example: 0.05.
- New token: empty/0.0. This is an input, not fetched data.

**Unit chip — "ETH"** · right of input
- The pay-side asset. In Sell mode this side becomes HOODS. Fixed per mode.

**Presets — 0.1 / 0.5 / 1 / MAX** · under input
- One-tap amounts; MAX uses the wallet balance. Selecting fills the input and highlights the chip.

**YOU RECEIVE amount — "14,730"** · receive box
- Quoted token amount for the entered ETH at the current curve price, after slippage.
- Format: token count, thousands-separated, 0dp (large counts). Example: 14,730.
- Update: recalculates on every input/price change (live quote). No input: "0". Quote failure: "—" with the CTA disabled.

**Receive chip — "HOODS"** · right of receive amount
- The receive-side asset; becomes ETH in Sell mode.

**SLIPPAGE — 0.5% / 1% / 3%** · below receive box
- Max price movement tolerated before the trade reverts. Selected chip highlights.
- Default: 1%.

**CTA — "Buy $HOODS" / "Sell $HOODS"** · bottom of panel
- Submits the trade. Label follows the Buy/Sell toggle.
- No wallet: reads "Connect wallet". Quote error/zero input: disabled.

**Fee note — "1% fee · 60% treasury / 40% creator · bonding"** · under CTA
- The curve's real trading fee (TRADING_FEE_BPS = 100) and its split, plus the curve phase. "bonding" flips to a graduated state label after graduation. Never show any other fee figure.

---

## 3 · Stats panel (left column, under swap)

**Stats / Audit tabs** · panel header — switches the panel body.
**5M / 1H / 24H selector** · panel header — sets the window for every paired row below. Default 24H.

Paired rows (all change with the TF selector, none with Price/MCap, all live):

**PRICE CHANGE** — price movement over the window. Signed % 1dp. Example 24H: +14.6%. New token: 0.0%. Error: "—".
**VOLUME** — total ETH traded in the window. ETH 1dp. Example: 184.2 ETH. New: 0 ETH. Error: "—".
**BUYS / SELLS** — count of buy vs sell trades. Counts 0dp. Example: 1,092 / 611. New: 0 / 0. Error: "— / —".
**BUY VOL / SELL VOL** — ETH in vs out. ETH 1dp. Example: 117.3 / 66.9 ETH. New: 0 / 0. Error: "—".
**BUYERS / SELLERS** — unique wallets each side. Counts. Example: 703 / 388. New: 0 / 0. Error: "—".
**Split bars** (under each pair) — green share vs red share of the pair. With zero activity: neutral empty track.

**HOLDER BREAKDOWN dropdown** · below the pairs
- Collapsed header shows total holders (2,417) + chevron; tap expands five rows.
- HOLDERS — total holding wallets. Count. 2,417. New: 0. Error: "—".
- TOP 10 % — share of supply held by the ten largest wallets, curve and LP addresses excluded. % 1dp. 18.4%. New: "—". Error: "—".
- DEV % — share held by the creator wallet. % 1dp. 4.2%. New: 0.0% (creators receive no allocation). Error: "—".
- SNIPERS % — share currently held by wallets (creator excluded) whose first buy landed within 60 seconds of the curve being funded. Hover ⓘ tooltip: "Wallets that bought within 60 seconds of launch · N wallets". % 1dp. 1.1%. New: 0.0%. Error: "—". (Owner ruling 4 Sep 2026: seconds, not blocks — this chain's blocks are sub-second, so a block count would be a few seconds and drift with block time; the creator is never a sniper, that holding is DEV %.)
- TOTAL FEES — lifetime protocol fees this token generated. ETH 2dp. 2.86 ETH. New: 0.00 ETH. Error: "—".
- These update live but slower refresh is fine (per block / per minute). Not affected by TF or Price/MCap.

**Audit tab checklist** · panel body when Audit selected
- Four contract facts, each with a pass check: "0% tax", "No mint function", "No owner", "LP locked at graduation".
- Format: boolean per row (check = true). These are guarantees of the Hoodlums factory contract, shown for any token the factory minted; footnote beneath the rows reads "Guaranteed by the Hoodlums factory contract".
- Unverified state (token not recognised as factory-minted, or check not yet run): grey dash instead of the check and dimmed row text — designed on the Build states page.

---

## 4 · Creator fees box (left column, bottom)

**Claimable — "0.00000012 ETH"**
- Fees accrued to the creator wallet, withdrawable now.
- Format: ETH, up to 8dp. Update: live.
- Only meaningful when the viewer IS the creator — for other wallets the box should hide.
- New token: 0.00000000 ETH. Error: "— ETH", button disabled.

**Withdraw fees button** — submits the claim transaction; disabled at zero balance.

---

## 5 · Chart panel (centre)

**Pair label — "HOODS / ETH"** · chart header — the market shown. Fixed per token.
**Small last price** · beside pair label — same value as the big figure's price mode, ETH at six significant figures (0.0000359717). Live, always price (ignores the toggle). New: starting price. Error: "—".
**Timeframe rail — 5M / 15M / 1H / 6H / 1D / ALL** · chart header — reloads the candle series for that interval. Default 1H.

**Candles** · plot
- OHLC + volume series for the selected interval; green up, red down.
- Format per candle: open/high/low/close in ETH per token at six significant figures, volume in ETH.
- Update: live — last candle mutates, new candle appends on interval close. The page must patch data in place, never reload (this is what causes the current site's refresh glitch).
- New token: empty plot with axes drawn and the centred note "No trades yet — the first buy starts the chart"; header shows the curve's starting price (Build states page). Error: keep last candles under a thin amber banner "Live data paused — showing last known prices" with a RETRY link (Build states page).

**MA 20 (lime) / MA 50 (white) lines** · plot overlay — moving averages computed from closes; recompute as candles update. Fewer than 20/50 candles: line starts once enough data exists (already how it renders).

**Dashed last-price line + lime axis tag** · plot/axis — always the latest trade price, 6dp. Live.

**Price axis labels** (6 ticks) · right gutter — derived from the visible range, 6dp. Recompute on data change.

**Time axis labels — "04:00 … 19:00"** · bottom strip — timestamps of the visible range, HH:MM UTC (wider intervals would show dates). Derived from data.

**Crosshair tooltip** · on hover
- Time ("10:00 UTC"), candle change % (signed 2dp), O / H / L / C (ETH, six significant figures each), VOL (ETH 1dp), plus a grey axis tag with the hovered close.
- Pure client-side read of the loaded series.

**VOL pane** · hidden by default (design tweak) — per-candle volume bars when enabled.

**Drawing tool rail** (2 buttons: crosshair, horizontal line) · left edge — selects the active tool. Client-side state only, no backend data. The remaining TradingView tools are deferred until Advanced Charts is adopted after the repo goes private.

---

## 6 · Tabs below the chart

**Tab rail — Recent trades / Holders / Hoodchat / About** — switches the panel body. Default Recent trades.

### Recent trades (live feed, newest first)
Per row: 
- **TYPE** — BUY ▲ (green) or SELL ▼ (red).
- **WALLET** — trader address, truncated 5+4 ("0x81ce…04d1").
- **AMOUNT** — token quantity traded, thousands-separated 0dp ("411,600").
- **ETH** — ETH value, 3dp, coloured by side ("0.393 ETH").
- **TIME** — age, coarse single unit ("2m", "8m").
- Update: live prepend, existing rows never reflow mid-read.
- New token: "No trades recorded yet." row. Error: "Couldn't load trades" row + retry.

### Holders (top holders, LP excluded)
Per row:
- **# rank** — position by balance (1–N).
- **Wallet** — truncated address; **DEV badge** when it's the creator wallet.
- **Bar** — balance relative to the largest holder (proportional width).
- **%** — share of total supply, 1dp ("14.2%").
- Update: per block / periodic. New token: single row = dev wallet. Error: "—" rows.

### Hoodchat (holders-only chat)
Per message: wallet (truncated), badge (DEV / HOLDER), age ("4m"), body text (280 max).
- Update: live append.
- Input placeholder "Chat about $HOODS…" + **Send** (lime) — posting requires a connected wallet holding the token; otherwise the input is disabled with placeholder "Connect a wallet holding $HOODS to chat" (Build states page).
- New token: empty feed ("Be the first to chat" treatment exists in the Hoodchat design). Error: "Chat unavailable".

### About
- **Story paragraph** — the creator-written description. Free text. New token: "No description has been published for this token yet." Error: same fallback.
- **BONDING CURVE LAUNCH badge** — launch mechanism, fixed per token type.
- **RHC badge** — chain, same source as the header chip.

---

## 7 · Full control list

1. **Back button** (band) — returns to the market list.
2. **Token art tile** (band) — creator only, and only when no art is set: opens file picker / accepts drop. Non-creators see a static initial-letter tile.
3. **Big figure** (band) — toggles PRICE ⇄ MCAP; label and figure swap, pill unchanged.
4. **Link chips ×2** (band) — Contract opens the explorer in a new tab; Pool does the same once graduated, disabled before.
5. **Buy / Sell** (swap) — switches trade direction; CTA label, unit chips and pay/receive sides swap.
6. **Amount input** (swap) — user types ETH (or HOODS in sell mode); receive quote recalculates.
7. **Presets 0.1 / 0.5 / 1 / MAX** (swap) — fill the input; chip highlights.
8. **ETH / HOODS unit chips** (swap) — display only.
9. **Slippage 0.5% / 1% / 3%** (swap) — sets tolerance; chip highlights.
10. **Buy $HOODS / Sell $HOODS CTA** (swap) — submits the trade; disabled without wallet/amount.
11. **Withdraw fees** (creator box) — submits fee claim; disabled at zero.
12. **Stats / Audit tabs** (stats panel) — swap the panel body.
13. **5M / 1H / 24H** (stats panel) — reloads all paired-row values for that window.
14. **HOLDER BREAKDOWN header** (stats panel) — expands/collapses the five rows; chevron rotates.
15. **Chart timeframe rail 5M–ALL** — reloads the candle series.
16. **Drawing tools ×2** (chart rail) — crosshair, horizontal line.
17. **Chart plot hover** — crosshair + OHLC tooltip + axis tags follow the cursor.
18. **Recent trades / Holders / Hoodchat / About tabs** — swap the lower panel body.
19. **Chat input + Send** — posts a message (wallet-gated).

---

### Cross-cutting notes for the backend
- One shared price source drives: big figure, change pill, chart last price, dashed line/axis tag, and the swap quote — they must never disagree on screen.
- Holder count appears in the band, the breakdown, and the Holders tab row count — single source.
- All live updates patch values in place; no polling that re-renders whole panels (the current site's visible refresh/glitch is exactly what this design forbids).
- Universal fallbacks: numeric values show "—" on fetch failure, never 0 (zero is a real value reserved for genuinely-zero data).


---

## 8 · Implementation rulings (backend mapping — agreed 29 Aug 2026)

**Already available, wire to the new layout**
- Name, ticker, chain badge, launch age, LIVE state: launch record + curve status.
- Graduation figures, bar, remaining ETH: `graduationProgressBps`, `nativeReserve`, `remainingNativeToGraduate`, `graduationTarget`.
- Swap panel: wallet, balance, `quoteBuy` / `quoteSell`, slippage, CTA — existing code.
- Creator fees: `claimableFees(creator)` — existing creator-only panel.
- Candles, last price, Recent trades: `/api/token-trades` (TokensPurchased / TokensSold events).
- Holders tab and holder count: existing Blockscout-backed holder stats. ONE source for every holder-count occurrence on the page.
- Hoodchat and About: existing panels.
- Contract link always; Pool link once `liquidityPool` is set.
- Artwork: `artworkThumbnail` from the launch record (tokens launched after #438 only).

**Derivable — same data, new maths, no new fetches**
- Stats paired rows (price change, volume, buys/sells, buy/sell vol, buyers/sellers) and Total fees: ONE pure aggregation function over the trades the chart already holds, filtered by the 5m/1h/24h window. Do not add a second trades fetch — the route is rate-limited at 600/hour/IP shared with everything else.
- Change pill and MA 20/50: client-side over the loaded candles.
- Market cap: last price × total supply, in ETH.
- Audit checklist: true by construction for factory-minted tokens; unverified state only if the token is not recognised as factory-minted.

**Needs one new server route** — `/api/token-holder-stats` (cached ~60s)
- Top 10 %: Blockscout holder list minus curve and LP addresses, over total supply.
- Dev %: `balanceOf(creator)` over total supply.
- Snipers %: distinct buyers (creator excluded) whose first TokensPurchased is within 60 seconds of the `CurveFunded` block's timestamp, current `balanceOf` summed, over total supply.

**Not obtainable on testnet — design already reflects this**
- USD anywhere. Price and market cap are ETH-denominated. Add a USD feed on mainnet later.
- Dexscreener / GeckoTerminal links (they do not index chain 46630).
- Bundlers % (Solana/Jito concept, no equivalent here) — excluded.
- Drawing tools beyond crosshair + horizontal line (Advanced Charts, after the repo is private).
- Post-launch art upload needs a creator-signed route — separate work; v1 only displays existing art and shows the drop tile to the creator when none is set.
- Hoodchat "holding the token" gating: verify what the current chat enforces before promising it.

**Hard requirements**
- One shared last-price source drives the big figure, change pill, chart last price, dashed line/axis tag and the swap quote.
- Every live update patches state in place (dedupe by tx hash/log index, append new, mutate last candle). Never replace whole arrays on poll — that is the cause of the current page's visible glitch.
- "—" on fetch failure, never 0.
- The mockup's figures are illustrative. Every number on the built page comes from chain or DB data; nothing is hard-coded.

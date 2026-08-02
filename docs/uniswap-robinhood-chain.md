# Uniswap on Robinhood Chain mainnet — deployment research

Research only, no code changes. Answers whether Uniswap V3 (and V2) is
deployed on Robinhood Chain mainnet (chain ID `4663`) and what the exact
contract addresses are.

## Bottom line

- **Uniswap V3 is deployed and live on Robinhood Chain mainnet — confirmed
  with high confidence.** Uniswap's own official blog and X/Twitter account
  announced it directly, and it's corroborated by independent trade-volume
  reporting.
- **Uniswap V2, V4, and UniswapX are also confirmed live** on the same
  chain, from the same day-one announcement.
- **Exact V3 contract addresses (Factory, NonfungiblePositionManager,
  SwapRouter, QuoterV2) were found and are reported below, but at
  moderate — not high — confidence.** Every official primary source
  (Uniswap's own deployments docs, Robinhood's own chain-contracts docs,
  the block explorer) blocked this session's automated page fetches with
  HTTP 403. The addresses below come from converging search-engine-indexed
  content rather than a direct read of the primary source, so **they must
  be manually confirmed in a browser before any implementation relies on
  them.** See §3 for exactly what was and wasn't independently verified.
- **Exact Uniswap V2 addresses (Factory, Router) were not found.** V2's
  presence on the chain is confirmed; its specific addresses are not.

---

## 1. Confirmed: Uniswap V2, V3, V4, and UniswapX are live on Robinhood Chain mainnet

Robinhood Chain mainnet (`4663`, an Arbitrum Orbit L2, ETH as gas token)
launched July 1, 2026. Uniswap deployed v2, v3, v4, and UniswapX on it from
day one, per Uniswap's own announcement:

> "Robinhood Chain is here, and Uniswap is the primary public AMM from day one."
> — [Uniswap's official X/Twitter announcement](https://x.com/Uniswap/status/2074508817186865501), linking to [blog.uniswap.org/robinhood-chain-is-live](https://blog.uniswap.org/robinhood-chain-is-live)

Independent corroboration: [cryptobriefing.com](https://cryptobriefing.com/robinhood-chain-500m-uniswap-volume/)
reported Robinhood Chain hit $500M in 24-hour trading volume on Uniswap
specifically (trailing only Ethereum mainnet), and
[OAK Research](https://oakresearch.io/en/analyses/investigations/who-is-biggest-winner-robinhood-chain-launch-uniswap-but-not-really)
covered Uniswap's role as the chain's dominant AMM in detail. This is about
as well-corroborated as an external fact gets — high confidence.

## 2. Uniswap V3 deployment addresses on Robinhood Chain — found, moderate confidence

These addresses converged across three independent research angles this
session: (a) a direct search for Uniswap's official Robinhood Chain
deployments page content, (b) a search specifically for the Pons launchpad's
own on-chain contract references (Pons builds directly on Uniswap V3, so
its own documented addresses double as a cross-check), and (c) a targeted
search for the specific address strings themselves paired with "Uniswap"
and "Robinhood." All three pointed to the same values:

| Contract | Address |
|---|---|
| **UniswapV3Factory** | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` |
| **NonfungiblePositionManager** | `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` |
| **SwapRouter** | `0xCaf681a66D020601342297493863E78C959E5cb2` |
| **QuoterV2** | `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` |

Each address passed a basic sanity check (40 hex characters after `0x`, no
truncation), but that only rules out an obvious copy error — it is not
confirmation of correctness. **Do not use these in any transaction, config,
or deployment without first confirming them directly against**:
- `https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments`
  (page confirmed to exist and be indexed under the title "Robinhood Chain
  Deployments | Uniswap Developers" — this session just couldn't read its
  body directly; see §3)
- `https://docs.robinhood.com/chain/protocol-contracts/` and
  `https://docs.robinhood.com/chain/contracts` (Robinhood's own chain-contracts
  docs, same fetch-blocked situation)
- Or by looking each address up directly on the Robinhood Chain block
  explorer (`https://robinhoodchain.blockscout.com/address/{address}`) and
  confirming the verified contract name matches.

Note one important, explicitly-stated Uniswap caveat found during this
research: **Uniswap warns integrators not to assume its contracts share
addresses across chains, and to always confirm addresses before use** —
this specific chain's addresses do *not* match Uniswap's older, widely-reused
deterministic address (`0x1F98431c8aD98523631AE4a59f267346ea31F984` for
`UniswapV3Factory` on Ethereum/Polygon/Optimism/Arbitrum/Avalanche), which
this research explicitly checked for and ruled out for Robinhood Chain —
another reason not to assume any address without confirming it for this
specific chain.

## 3. What blocked full verification, and what that does and doesn't mean

Every direct-fetch attempt at a primary source returned HTTP 403 this
session:
- `developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments`
- `docs.robinhood.com/chain/protocol-contracts/` and `/contracts`
- `gov.uniswap.org` (official V3 deployments forum thread)
- `support.uniswap.org` (Uniswap Labs deployment-addresses help article)
- `robinhoodchain.blockscout.com/address/{address}` (the block explorer itself)

These are consistent with standard bot-protection (e.g., Cloudflare)
blocking this session's automated fetch tool specifically — search engines
clearly *can* read and index these same pages (their titles and some
content appear correctly in search results), so this is a tooling
limitation of this research session, not evidence the pages don't exist or
are wrong.

As a cross-check, this session tried reading the GitHub source repository
that appears to back `developers.uniswap.org`
(`github.com/Uniswap/docs-content`). Its `protocols/v3/deployments/`
directory and `meta.json` navigation config, as of the most recent visible
commit (April 8, 2026), list 14 chains — including Monad, a comparably new
chain — but **no Robinhood Chain page**. That commit predates Robinhood
Chain's July 1, 2026 mainnet launch by about three months, so the simplest
explanation is that this particular repo snapshot/branch just hasn't been
updated since — not that the live docs site lacks the page (search engines
clearly found *something* titled "Robinhood Chain Deployments | Uniswap
Developers" at that exact URL). Flagging this rather than omitting it,
since it's a genuine loose end: the addresses in §2 did not come from
directly reading that specific official page's body text.

## 4. Uniswap V2 — confirmed available, exact addresses not found

Multiple sources confirm V2 was deployed on Robinhood Chain alongside V3,
v4, and UniswapX as part of the same day-one rollout (see §1's sources).
**This research did not find specific V2 Factory/Router addresses for
Robinhood Chain** — searches kept surfacing V3-specific results instead.
Uniswap V2's Factory and Router02 do have widely-reused deterministic
addresses on many chains (`0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` and
`0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` respectively), but — per the
same caution as §2 — this research found no direct evidence connecting
those specific addresses to Robinhood Chain, and given that Robinhood
Chain's V3 addresses turned out **not** to match the reused-elsewhere
pattern, there's no good reason to assume V2 would either. Treat V2's exact
addresses as **unconfirmed and not found**, to be looked up the same way as
V3's in §2 rather than assumed.

## 5. Recommendation

Uniswap V3 (and V2) being live on Robinhood Chain mainnet is solid enough
to plan around. The specific addresses in §2 are a strong lead — three
independent angles converged on the same values — but they should be
pasted into a browser against the three official sources listed there (or
looked up fresh on the block explorer) as a five-minute manual check before
they go anywhere near a config file or a contract call. This is exactly
the kind of fact where "moderately confident from search-engine synthesis"
and "confirmed by directly reading the source" need to stay clearly
distinguished, given what's at stake if a wrong router address were ever
wired into a live swap.

## Sources

- [Uniswap is Live on Robinhood Chain — Uniswap blog](https://blog.uniswap.org/robinhood-chain-is-live)
- [Uniswap official X/Twitter announcement](https://x.com/Uniswap/status/2074508817186865501)
- [Robinhood Chain hits $500M in 24-hour volume on Uniswap — CryptoBriefing](https://cryptobriefing.com/robinhood-chain-500m-uniswap-volume/)
- [Who is the biggest winner of the Robinhood Chain launch? Uniswap, but not really... — OAK Research](https://oakresearch.io/en/analyses/investigations/who-is-biggest-winner-robinhood-chain-launch-uniswap-but-not-really)
- `developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments` — page confirmed to exist via search indexing; direct fetch blocked (403) this session
- `docs.robinhood.com/chain/protocol-contracts/`, `docs.robinhood.com/chain/contracts` — Robinhood's own chain-contracts docs; direct fetch blocked (403) this session
- `github.com/Uniswap/docs-content` (`protocols/v3/deployments/meta.json` and directory listing) — read directly; does not list Robinhood Chain as of its last visible commit (Apr 8, 2026, predating the chain's July 1, 2026 launch)
- Pons launchpad's own documented Uniswap V3 periphery contract references (Position manager, Swap router, Quoter V2 addresses), cross-checked against the V3 deployment addresses above — consistent with Pons building directly on the same Robinhood Chain Uniswap V3 deployment
- [Uniswap V3 Factory shares one address across Ethereum/Polygon/Optimism/Arbitrum/Avalanche — Etherscan/Polygonscan/Arbiscan listings](https://etherscan.io/address/0x1f98431c8ad98523631ae4a59f267346ea31f984), explicitly checked and ruled out for Robinhood Chain

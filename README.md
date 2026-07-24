# HOODLUMS Launch Platform

HOODLUMS is a browser-based workspace for preparing and testing a meme-token launch. It keeps project data in the browser, uses connected wallets for every blockchain approval, and separates the launch workflow into a studio, provider handoff, token allocation, testnet liquidity tools, and a bonding-curve graduation workspace.

The application is intentionally **testnet-first**. It does not offer an unattended mainnet deploy, custody funds, or ask for seed phrases or private keys.

## Current features

### Launch studio

- Create, save, reopen, delete, and export token projects from browser storage.
- Configure a token name, ticker, description, fixed supply, decimals, website slug, contract address, X profile, and Telegram link.
- Target Solana or Robinhood Chain Testnet.
- Upload artwork up to 20 MB and optimize it in the browser before saving it with the project.
- Generate five artwork-directed token landing-page directions, each with a genuinely different composition, navigation, hero treatment and section rhythm.
- Preview all five in isolated frames, switch between them without another AI call, save the chosen design with the project, and automatically show a Dexscreener chart when a trading pair is found for the saved contract address.
- Detect compatible injected wallets while keeping signing and approvals in the wallet.

Project records and generated-site state are local to the current browser; cross-device accounts and hosted project synchronization are not active yet.

### Artwork-driven site generation

The **Generate site from artwork** flow becomes available after the required project details and artwork are present. One protected browser request analyses the artwork (and optional inspiration) once, then runs five full-page OpenAI generations in parallel and returns five self-contained landing-page previews rather than fixed demo copy.

The five stable directions are **Editorial Poster** (asymmetrical magazine storytelling), **Cinematic Showcase** (full-bleed scene-led pacing), **Modular Cardscape** (varied bento modules), **Kinetic Collage** (overlap, diagonals and playful movement), and **Minimal Gallery** (restrained artwork-first exhibition pacing). Server-side variant markers and a structural diversity check reject missing directions, duplicate layouts and obvious colour-swap-only outputs. The first direction is selected by default; creators can switch among all five without another request, and only the currently chosen HTML plus variant ID/label is saved with the project/public payload.

This feature keeps the same OpenAI Responses runtime, secret/origin checks, no-store headers and 10-request/hour per-IP protection. A generation action still consumes one request-limit slot, but it now performs five full-page model calls after the shared analysis, so full-page AI usage and cost are roughly five times the previous one-page generation.

Generation endpoints support an origin check and shared-secret protection. Configure the server and browser bridge with matching values:

```bash
OPENAI_API_KEY=your_server_side_key
OPENAI_VISION_MODEL=gpt-5-mini
GENERATE_SITE_STYLE_ALLOWED_ORIGIN=http://localhost:3000
GENERATE_SITE_STYLE_SHARED_SECRET=replace_with_a_long_random_value
NEXT_PUBLIC_GENERATE_SITE_STYLE_SHARED_SECRET=replace_with_the_same_value
```

`OPENAI_API_KEY` must remain server-side; never expose it through a `NEXT_PUBLIC_` variable. The public shared secret is an access gate, not a substitute for user authentication.

### Robinhood provider desk

The provider workflow prepares a launch package for an external launch provider without taking custody of the token or creator funds. It can:

- Load a saved studio project and connect an EVM wallet to Robinhood Chain Testnet (chain ID `46630`).
- Copy the complete launch package or individual project fields and download the artwork.
- Open the selected provider for the wallet-signed launch.
- Verify the resulting contract and display discovered token details.
- Open the provider's buy flow, track the creator purchase separately, and refresh the connected wallet's token balance.
- Save the verified launch address back to local project records.

Provider launch and purchase transactions occur on the provider site and in the user's wallet; they are not atomic transactions controlled by this application.

### Allocation and distribution desk

For a deployed Robinhood Chain Testnet ERC-20, the allocation desk can:

- Read token metadata and the connected wallet's balance from the contract.
- Plan liquidity, community, team, and reserve percentages with an exact 100% check.
- Send community, team, and reserve allocations as separate wallet-approved ERC-20 transfers.
- Record confirmed transaction hashes, destination wallets, and planned native-token liquidity.
- Save allocation plans in browser storage and download them as JSON launch records.

Liquidity tokens remain in the connected wallet until a verified pool transaction is ready. The desk does not provide vesting contracts, and its production liquidity router is deliberately disabled.

### Testnet liquidity lab

The Liquidity Lab supports a private, test-only constant-product pool on Robinhood Chain Testnet. After deploying `contracts/HoodlumsTestLiquidityPool.sol` separately, users can register its address, approve token spending, add initial token/test-ETH liquidity, and inspect pool reserves. The lab is for testing only and is not an audited production AMM.

### Bonding curve workflow

The `/bonding-curve` route is the fifth launch-workflow page. It explains the approved full-supply launch model, wallet-signed curve trading, the graduation target, automatic Hoodlums pool creation, and permanent initial LP locking. The bonding-curve contract foundation is merged, but it is not deployed or connected to live buy/sell controls yet.

`contracts/HoodlumsTestBondingCurve.sol` charges a fixed **1% trading fee on every buy and sell**, split **60% to the protocol treasury and 40% to the token creator** (`TRADING_FEE_BPS = 100`, `PROTOCOL_FEE_SHARE_BPS = 6000`, `CREATOR_FEE_SHARE_BPS = 4000`; both the treasury and creator addresses are constructor parameters, never hardcoded). Fees use **pull payments only**: a buy or sell never pushes native currency to the treasury or creator, it only credits a claimable balance (`treasuryFeeBalance`, `creatorFeeBalance`), which either recipient withdraws themselves via `withdrawFees()`. This means a reverting or gas-griefing treasury or creator can never block a buy, a sell, graduation, or the other recipient's withdrawal. The fee is deducted from the gross trade amount before the curve quote (buys) or from the curve's gross output before payout (sells), so `realNativeReserve` and the graduation target only ever reflect post-fee amounts; accrued fees are tracked separately from curve/pool liquidity and remain withdrawable both before and after graduation.

### Factory deployment (live on Robinhood Chain Testnet)

`contracts/HoodlumsTokenFactory.sol` is deployed and verified on Robinhood
Chain Testnet (chain ID `46630`):

| | |
| --- | --- |
| Factory | `0x39207baa4d0a30a5194770563ec586978c9fbcb3` |
| Owner | `0x3990b0b29f08c1D415978E8EDB93aD00E5dC966a` |
| Treasury | `0x505217CBbe3059993877983b4fDAD5C6e32AF1F5` |
| Launch fee | `0` |

`lib/factory-config.ts` ships this address as a public default for chain
`46630`, so the `/testnet` route (`components/testnet-launcher.tsx`) reads
`launchFee()`, calls `launchToken()` with exactly that fee as the
transaction value, and resolves the created token address from the
confirmed receipt's `TokenLaunched` event — no configuration required. A
redeploy, or a factory on another chain, can still be pointed at with
`NEXT_PUBLIC_HOODLUMS_FACTORY_ADDRESSES` (public JSON, e.g.
`{"46630":"0xYourDeployedAddress"}`), which overrides the default per chain.
If no factory address is configured for the connected chain, `/testnet`
falls back to the direct `FixedSupplyMemeToken` deployment unchanged.

A Hardhat script prepares (and, run deliberately, performs) this
deployment:

```bash
npm run contracts:compile
npm run deploy:factory:robinhood
```

Required environment variables (set locally, e.g. in `.env.local`; never
commit real values):

| Variable | Purpose |
| --- | --- |
| `ROBINHOOD_TESTNET_RPC_URL` | RPC endpoint used by the `robinhoodTestnet` Hardhat network. |
| `HOODLUMS_FACTORY_DEPLOYER_PRIVATE_KEY` | Private key of the funded testnet-only account that sends the deployment transaction. Read only by Hardhat at deploy time; never logged, stored, or committed. |
| `HOODLUMS_FACTORY_OWNER_ADDRESS` | Constructor `initialOwner` — the address that can adjust the launch fee and fee recipient after deployment. |
| `HOODLUMS_FACTORY_TREASURY_ADDRESS` | Constructor `initialFeeRecipient` — the treasury address that would receive launch fees. |

The script deploys with `initialLaunchFee = 0` and prints the deployed
address plus the exact constructor arguments for explorer verification. It
does not touch the `/testnet` UI or update
`NEXT_PUBLIC_HOODLUMS_FACTORY_ADDRESSES`, and is never run automatically —
running it is a deliberate, owner-initiated action.

### Wallet-signed token test lab

The `/testnet` route supports two proof-of-launch flows:

- **Robinhood Chain Testnet:** add or switch to chain ID `46630`, then deploy through the live HoodlumsTokenFactory above (paying its current `0` launch fee) or, if no factory is configured for the connected chain, deploy a burnable fixed-supply ERC-20 directly. Either way the contract has no owner or external mint function and the complete supply mints once to the signing wallet.
- **Solana devnet:** create an SPL mint and associated token account, mint the selected fixed supply to the connected Phantom wallet, and permanently revoke mint authority.

Both flows return a transaction or token address with an explorer link. They do not create metadata, liquidity, a bonding curve, or a public sale. A custom Solana endpoint can be supplied with `NEXT_PUBLIC_SOLANA_DEVNET_RPC`.

An additional `/monad` test page deploys the same fixed-supply EVM token design on Monad Testnet and blocks deployment unless the wallet reports chain ID `10143`.

### Social publishing workspace

The `/social` route loads saved projects and provides reusable launch, contract-live, and community announcement drafts. Users can edit and save copy locally, copy it, download project artwork, open the official X composer for final approval, and publish to Telegram with their own bot token and channel ID. Telegram bot tokens are submitted only for the requested post, cleared from the form afterward, and are not stored in browser project data.

### Account status

The `/account` route previews planned Google, GitHub, X, MetaMask, Rabby, and Phantom account options. These controls are currently disabled; wallet connections inside individual launch tools continue to work independently.

### Public generated token site (route + renderer only — not yet publishable)

`app/[slug]/page.tsx` is a root dynamic route so a persisted project would be servable at `https://hoodlums.dev/<slug>`. It is a **complete route, renderer, validation and metadata scaffold with no durable backend behind it yet** — see the honesty note below before assuming anything is publicly live.

- **Data contract:** `lib/public-site.ts` defines `PublicGeneratedSite` (slug, token name/ticker/description/supply/decimals/chain, artwork, generated HTML, optional contract address/X/Telegram, status, timestamps) and a pure `buildPublicGeneratedSiteFromProject()` mapper from a saved `TokenProject`.
- **Repository boundary:** `lib/server/public-generated-sites.ts` exposes `getPublicGeneratedSiteBySlug(slug)`. No durable store exists, so the default adapter always returns no record — it deliberately does not fall back to an in-memory `Map` or browser storage, because that would look like persistence without surviving a restart or being shared across serverless instances. `setPublicGeneratedSiteAdapter()` lets tests inject a fixture; production code has nothing to inject yet.
- **Rendering:** the route loads only through that repository boundary (never `localStorage`), validates the path slug, and calls `notFound()` for an unknown, invalid, or missing record. When a record exists with complete, validated generated HTML and artwork, it renders that HTML sandboxed in a client iframe (`components/public-site-frame.tsx`, reusing `lib/generated-site-page.ts`'s existing validation/CSP/`postMessage` height bridge — never raw `dangerouslySetInnerHTML`). Otherwise it renders a safe plain-token-details fallback (`components/public-token-fallback.tsx`) instead of crashing or serving corrupt HTML.
- **Metadata and artwork/OG image:** `generateMetadata` returns a title with the token name/ticker, the token description, a canonical `https://hoodlums.dev/<slug>` URL, and Open Graph/Twitter metadata. The image is an HTTP-fetchable endpoint, `app/[slug]/artwork/route.ts`, not a `data:` URL in metadata — it re-validates the record and artwork MIME type and returns `404` (no body) for anything missing or invalid, and metadata for an unknown/invalid slug is `{}` rather than crashing.
- **Dexscreener:** when the record has a non-empty contract address, the page shows `components/public-dexscreener-section.tsx`, which calls the existing `/api/dexscreener-pair` endpoint (via the new shared `lib/dexscreener-client.ts` helper, also now used by the studio's own Dexscreener section) and falls back to the same safe empty state when no pair is found. No contract address means the section is omitted entirely.

### Slug rules

`lib/slug.ts` is the single source of truth for website-path rules, shared by the studio save flow and the public route:

- lowercase ASCII letters, digits and single hyphens only;
- 48 characters maximum (unchanged from the previous limit);
- no leading/trailing hyphen, no repeated hyphens;
- reserved and rejected outright: `api`, `account`, `testnet`, `providers`, `allocations`, `liquidity-lab`, `monad`, `social`, `bonding-curve`, `admin`, `www`.

At save time, `components/token-studio.tsx` rejects an invalid or reserved slug and a slug that collides with another locally saved project (excluding the project being edited), leaving the form open and the notice bar showing the reason instead of silently saving or overwriting the other project. The website-path field now shows the real `hoodlums.dev/` prefix. **This collision check only sees projects saved in the same browser** — it is a local UX guard, not a uniqueness guarantee. The future publish endpoint must still perform its own atomic, server-side unique-slug constraint.

### Capturing the generated design for a future publish

`TokenProject` stores the chosen design in optional `generatedSiteHtml`/`generatedSiteVersion` plus `generatedSiteVariantId`/`generatedSiteVariantLabel` fields. The studio listens for the existing `launchpad:site-generated` event (carrying validated selected HTML and variant metadata), re-validates it, and updates the current project without scraping the DOM. Switching a preview replaces the chosen HTML/metadata without another fetch. Changing the token name, ticker, description, or artwork clears all captured design fields so one token cannot carry a stale page. This is only local capture; public publishing persistence remains unchanged.

## Routes

| Route | Purpose | Status |
| --- | --- | --- |
| `/` | Project studio, artwork upload, site generation, and Dexscreener preview | Available |
| `/providers` | Robinhood provider handoff, contract verification, and creator-buy tracking | Available; external actions require a provider and wallet |
| `/allocations` | Allocation planning and wallet-approved testnet distribution | Available |
| `/liquidity-lab` | Register and fund a separately deployed test AMM | Test-only |
| `/bonding-curve` | Review the full-supply curve and automatic pool-graduation lifecycle | Foundation page; live trading not active |
| `/testnet` | Robinhood Chain Testnet and Solana devnet token creation | Test-only |
| `/monad` | Monad Testnet ERC-20 deployment | Test-only |
| `/social` | X handoff and Telegram publishing workspace | Available |
| `/account` | Account-provider interface preview | Coming later |
| `/[slug]` | Public generated token site (route, renderer, metadata and OG image) | Route/renderer complete; not publishable — no durable store or publish write path yet |

## Safety model and limitations

- The application never requests or stores a seed phrase or private key.
- Blockchain transactions require explicit approval in the connected wallet.
- Mainnet deployment is not exposed by the studio or test lab.
- Testnet actions spend test ETH, test MON, or devnet SOL and do not create a market by themselves.
- Browser-local project data is not an encrypted vault or a hosted backup.
- The platform does not yet provide hosted image/metadata storage, automatic site publishing, domains, audited vesting, or production liquidity management.
- The `/[slug]` public route, its renderer, its data contract and its local slug validation are complete, but no generated site is actually publicly reachable yet: the repository boundary's default adapter always returns no record, so every slug 404s until a durable store, an authenticated/authorised publish write path, and an atomic server-side unique-slug constraint are added. No user accounts were added as part of this.
- Contracts and test liquidity tooling should be independently reviewed before any production use.

## Development

Requirements: a current Node.js release supported by Next.js 16 and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the launch studio. The other tools are available at the routes listed above.

## Validation

```bash
npm run lint
npm test
npm run build
```

The test command runs the Vitest application suite followed by the Hardhat Solidity tests. GitHub Actions also runs linting and a production Next.js build for branch updates and pull requests.

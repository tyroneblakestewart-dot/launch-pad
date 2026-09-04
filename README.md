# HOODLUMS Launch Platform

HOODLUMS is a browser-based workspace for preparing and testing a meme-token launch. It keeps project data in the browser, uses connected wallets for every blockchain approval, and separates the launch workflow into a studio, provider handoff, token allocation, testnet liquidity tools, and a bonding-curve graduation workspace.

The application is intentionally **testnet-first**. It does not offer an unattended mainnet deploy, custody funds, or ask for seed phrases or private keys.

## Current features

### Launch studio

- Create, save, reopen, delete, and export token projects from browser storage.
- Configure a token name, ticker, description, fixed supply, decimals, website slug, contract address, X profile, and Telegram link.
- Target Solana or Robinhood Chain Testnet.
- Upload artwork up to 20 MB and optimize it in the browser before saving it with the project.
- Generate an artwork-directed token landing page, including its palette, typography, layout, and project-specific copy.
- Preview the generated page in an isolated frame and automatically show a Dexscreener chart when a trading pair is found for the saved contract address.
- Detect compatible injected wallets while keeping signing and approvals in the wallet.

Private project records and draft generated-site state remain local to the current browser; cross-device accounts and hosted private-draft synchronization are not active. A project becomes durable only when its generated site is explicitly published through the signed server endpoint described below.

### Artwork-driven site generation

The **Generate site from artwork** flow becomes available after the required project details and artwork are present. Site style analysis can use OpenAI vision, and the full-page generator returns a self-contained landing-page preview based on the project rather than fixed demo copy.

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

The `/bonding-curve` route is the fifth launch-workflow page. It explains the approved full-supply launch model, wallet-signed curve trading, the graduation target, the one-off 5% graduation fee, automatic Hoodlums pool creation, and permanent initial LP locking. The bonding-curve contract foundation is merged, but it is not deployed or connected to live buy/sell controls yet.

`contracts/HoodlumsTestBondingCurve.sol` charges a fixed **1% trading fee on every buy and sell**, split **60% to the protocol treasury and 40% to the token creator** (`TRADING_FEE_BPS = 100`, `PROTOCOL_FEE_SHARE_BPS = 6000`, `CREATOR_FEE_SHARE_BPS = 4000`; both the treasury and creator addresses are constructor parameters, never hardcoded). Fees use **pull payments only**: a buy or sell never pushes native currency to the treasury or creator, it only credits a claimable balance (`treasuryFeeBalance`, `creatorFeeBalance`), which either recipient withdraws themselves via `withdrawFees()`. This means a reverting or gas-griefing treasury or creator can never block a buy, a sell, graduation, or the other recipient's withdrawal. The fee is deducted from the gross trade amount before the curve quote (buys) or from the curve's gross output before payout (sells), so `realNativeReserve` and the graduation target only ever reflect post-fee amounts; accrued fees are tracked separately from curve/pool liquidity and remain withdrawable both before and after graduation.

At graduation the curve also charges a **one-off 5% graduation fee** on the post-trading-fee native reserve (`GRADUATION_FEE_BPS = 500`, rounded down so rounding favours pool liquidity), credited **100% to the treasury's claimable balance** — the creator receives none of it, and like every trading fee it is pull-payment only (`withdrawFees()`), never pushed. Only the remaining 95% is wrapped and seeded into the locked pool; `Graduated.nativeLiquidity` reports that post-fee amount and a `GraduationFeeCharged(amount)` event reports the fee. `graduationFeeAtTarget()` exposes the fee a curve will charge, and `minimumCurveFunding()` measures its pool-liquidity floor against the post-fee amount. The fee never changes curve pricing, the graduation target or the buy clamp — `realNativeReserve` still has to equal `graduationTarget` exactly. Curves deployed before this constant existed charge no graduation fee; the token page reads each curve's own `GRADUATION_FEE_BPS()` and only describes a fee the specific curve actually charges. **The already-deployed testnet launch pipeline deploys the previous curve bytecode, so this fee only reaches new launches once the pipeline is redeployed** (see "Curve launch pipeline deployment").

**Live graduation status.** `components/bonding-curve-graduation-status.tsx` is a read-only view rendered on `/bonding-curve` that reads a configured curve directly from a public Robinhood Chain Testnet RPC endpoint (no wallet connection required) and displays one of three states: **not yet funded** (creator hasn't placed the token supply into the curve), **bonding** (a progress bar showing `realNativeReserve` against `graduationTarget`, which already excludes every accrued trading fee, matching the contract's own `graduationProgressBps()`), or **graduated** (the locked pool address with an explorer link and a note that its liquidity is permanently locked). `lib/bonding-curve-config.ts` reads the curve address from `NEXT_PUBLIC_HOODLUMS_BONDING_CURVE_ADDRESSES` (public JSON, e.g. `{"46630":"0xYourDeployedCurve"}`), mirroring `NEXT_PUBLIC_HOODLUMS_FACTORY_ADDRESSES` / `getFactoryAddress` below — unlike the factory, there is no public default yet, so an unset env var renders a truthful "not deployed" state instead of guessing an address. This view never sends a transaction; buy/sell controls are still not wired up.

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

### Bonding curve deployment (drill)

Two Hardhat scripts prepare (and, run deliberately, perform) a manual proof
that `contracts/HoodlumsTestBondingCurve.sol` graduates correctly on
Robinhood Chain Testnet. Neither script is run automatically, wired into the
`/bonding-curve` UI, or invoked by CI — they exist for an owner-initiated
deployment drill: deploy a curve for a real token, drive it to its
graduation target by hand, and watch `_graduate()` fire and seed the locked
pool.

**1. Deploy the curve** for a token you've already launched (e.g. via the
live factory above or the direct `/testnet` deploy flow):

```bash
npm run contracts:compile
npm run deploy:bonding-curve:robinhood
```

Required environment variables (set locally, e.g. in `.env.local`; never
commit real values):

| Variable | Purpose |
| --- | --- |
| `ROBINHOOD_TESTNET_RPC_URL` | RPC endpoint used by the Hardhat network. |
| `HOODLUMS_BONDING_CURVE_DEPLOYER_PRIVATE_KEY` | Private key of the funded testnet-only account that sends the deployment transaction. Read only by Hardhat at deploy time; never logged, stored, or committed. |
| `HOODLUMS_BONDING_CURVE_TOKEN_ADDRESS` | The already-deployed ERC-20 this curve will trade. |
| `HOODLUMS_BONDING_CURVE_CREATOR_ADDRESS` | Constructor `creator_` — must be the wallet holding the token's complete current supply; only it can call `fundCurve()` and receives the 40% creator fee share. |
| `HOODLUMS_BONDING_CURVE_TREASURY_ADDRESS` | Constructor `treasury_` — receives the 60% protocol fee share. |
| `HOODLUMS_BONDING_CURVE_POSITION_MANAGER_ADDRESS` | Constructor `positionManager_` — the Uniswap V3 `NonfungiblePositionManager` `_graduate()` calls to mint the full-range graduation position. |
| `HOODLUMS_BONDING_CURVE_UNISWAP_V3_FACTORY_ADDRESS` | Constructor `uniswapV3Factory_` — the Uniswap V3 factory `_graduate()` uses to look up or create the token/WETH pool (1% fee tier). |
| `HOODLUMS_BONDING_CURVE_WETH9_ADDRESS` | Constructor `weth9_` — the WETH contract `_graduate()` wraps the native reserve into before seeding liquidity. |

None of the three Uniswap V3 addresses above has a hardcoded fallback in the
contract, this script, or `lib/bonding-curve-deploy-config.ts` — every
deployment must supply them explicitly. **Always get the canonical
`NonfungiblePositionManager` / `UniswapV3Factory` / `WETH9` addresses for
your target chain directly from Uniswap's own official developer docs
(developers.uniswap.org)**, not from a chat message, issue, or PR
description — addresses copied secondhand have already been caught
containing transcription errors during this project's review process (see
issue #227). **This does not exist for Robinhood Chain Testnet (46630)** —
Uniswap's docs only document Robinhood Chain **mainnet** (4663), listed
below; see "Uniswap V3 testnet deployment" further down for the testnet-only
stand-in stack this repo deploys itself (issue #414) and the addresses that
section's script prints. As of issue #227, the following
Uniswap V3 addresses were verified against Uniswap's docs for **Robinhood
Chain mainnet (chain ID 4663)** — note this repo's `lib/chains.ts` only
configures Robinhood Chain **Testnet** (`46630`) today and deliberately
aliases `ROBINHOOD_MAINNET` back to testnet as a safety measure, so these
mainnet values are for future reference only, not for use against the
testnet deployment target below:

| Contract | Address | Used by this curve? |
| --- | --- | --- |
| `NonfungiblePositionManager` | `0x73991a25c818bf1f1128deaab1492d45638de0d3` | Yes — `positionManager_` |
| `UniswapV3Factory` | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` | Yes — `uniswapV3Factory_` |
| `WETH9` | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | Yes — `weth9_` |
| `SwapRouter02` | `0xcaf681a66d020601342297493863e78c959e5cb2` | No — reference only, for future trading-UI work |
| `QuoterV2` | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` | No — reference only |
| `UniversalRouter` | `0x8876789976decbfcbbbe364623c63652db8c0904` | No — reference only |
| `Permit2` | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | No — reference only |

`Permit2` above is Uniswap's well-known canonical cross-chain deployment
address; the value originally pasted into issue #227 was one hex digit short
of a valid address, corrected here from that canonical value. Re-verify all
seven addresses independently against Uniswap's docs before using any of
them in a real deployment — this table is a record of what was checked for
issue #227, not a substitute for checking again at deploy time.

Optional overrides (documented defaults below are used when unset):

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOODLUMS_BONDING_CURVE_TOKEN_DECIMALS` | `18` | Must match the token's actual `decimals()` — the script reads it on-chain and aborts on a mismatch. |
| `HOODLUMS_BONDING_CURVE_GRADUATION_TARGET_ETHER` | `4` | Constructor `graduationTarget_`, in native testnet currency. |
| `HOODLUMS_BONDING_CURVE_VIRTUAL_ETH_RESERVE_ETHER` | `1` | Constructor `virtualEthReserve_`, in native testnet currency. |
| `HOODLUMS_BONDING_CURVE_VIRTUAL_TOKEN_RESERVE_WHOLE` | `1000000` | Constructor `virtualTokenReserve_`, in whole tokens (scaled by the token's decimals). |

The 1% trading fee, its 60/40 treasury/creator split and the 5% graduation
fee are contract constants (`TRADING_FEE_BPS`, `PROTOCOL_FEE_SHARE_BPS`,
`CREATOR_FEE_SHARE_BPS`, `GRADUATION_FEE_BPS`), not constructor arguments —
this script cannot change them. The script prints the deployed address, the exact constructor
arguments for explorer verification, and `minimumCurveFunding()` so you know
whether the token's total supply is enough to fund the curve.

**2. Drive the curve to graduation.** Once the creator wallet holds the
token's complete current supply, run:

```bash
npm run graduate:bonding-curve:robinhood
```

Required/optional environment variables:

| Variable | Purpose |
| --- | --- |
| `HOODLUMS_BONDING_CURVE_CREATOR_PRIVATE_KEY` | Private key of the `creator` wallet from step 1. Read only by Hardhat at run time; never logged, stored, or committed. |
| `HOODLUMS_BONDING_CURVE_ADDRESS` | The curve address printed by step 1. |
| `HOODLUMS_BONDING_CURVE_BUY_STEP_ETHER` (optional, default `1`) | Size of each intermediate buy while driving toward the graduation target. |

This script approves the curve for the complete token supply and calls
`fundCurve()` if it hasn't been funded yet, then repeatedly calls `buy()` in
`HOODLUMS_BONDING_CURVE_BUY_STEP_ETHER`-sized steps. The final step computes
the exact gross native input whose post-fee net lands exactly on the
remaining amount to graduate — `buy()` only calls `_graduate()` when
`realNativeReserve` equals `graduationTarget` exactly, so an approximate
last buy would leave the curve permanently short. Once graduated, it prints
the Uniswap V3 pool address and LP NFT token ID that `_graduate()` created
and permanently locked at `address(1)`.

If you'd rather drive individual steps by hand instead of running this
script, the same effect can be reproduced with `cast send` (Foundry) or a
short ethers/viem snippet: `approve(curveAddress, totalSupply)` and
`fundCurve()` on the token, then repeated `buy(minTokensOut, deadline)` calls
sending native value, ending with one calling `quoteBuyFee()`/`buy()` at the
exact remaining amount from `remainingNativeToGraduate()`.

Once a curve is deployed, set `NEXT_PUBLIC_HOODLUMS_BONDING_CURVE_ADDRESSES`
(see "Live graduation status" above) to see its progress and graduation
state on `/bonding-curve` — neither script does this automatically.

### Uniswap V3 testnet deployment

Milestone A's graduation path (`HoodlumsTestBondingCurve._graduate()`) calls
a live Uniswap V3 `NonfungiblePositionManager`. As the caveat above says,
Uniswap's official docs and Robinhood's own chain docs only document a
Uniswap V3 deployment for Robinhood Chain **mainnet** (4663) — there is no
documented official Uniswap V3 or WETH9 deployment on Robinhood Chain
**Testnet** (46630). Without one, the final graduation buy in the deployment
drill or the curve launch pipeline reverts. `scripts/deploy-uniswap-v3-testnet.ts`
(issue #414) deploys a testnet-only stand-in stack — canonical, unmodified
Uniswap contracts, never hand-edited — so that drill can complete:

1. **WETH9** — the canonical WETH9 bytecode, loaded from
   `@uniswap/v2-periphery`'s published build artifact (the same canonical
   WETH9 Uniswap itself has reused, unmodified, across every deployment
   since 2018).
2. **UniswapV3Factory** — Uniswap V3 Core's canonical factory, loaded from
   `@uniswap/v3-core`'s published Hardhat artifact.
3. **NFTDescriptor** (library) and **NonfungibleTokenPositionDescriptor**,
   then **NonfungiblePositionManager** pointed at the factory and WETH9
   above — all three from Uniswap V3 Periphery's published Hardhat
   artifacts (`@uniswap/v3-periphery`).

Every contract is deployed from Uniswap's own compiled bytecode read
directly out of the installed npm package (`scripts/deploy-uniswap-v3-testnet.ts`'s
`loadExternalArtifact`) — this repo never recompiles or hand-edits any of
these sources itself. `lib/uniswap-v3-artifact-linking.ts` holds the one
piece of real logic involved (patching solc's library-placeholder bytes to
link NFTDescriptor into the token descriptor, and encoding the native
currency label), kept dependency-free so it's unit tested directly in
`tests/uniswap-v3-artifact-linking.test.ts`.

**Package versions.** `package.json` pins `@uniswap/v2-periphery@1.1.0-beta.0`,
`@uniswap/v3-core@1.0.0`, and `@uniswap/v3-periphery@1.4.4` — the versions
believed to match Uniswap's own mainnet deployments. These pins and all five
artifact paths `scripts/deploy-uniswap-v3-testnet.ts` reads have since been
verified against the live npm registry (issue #416): every path resolves
after `npm install` and each artifact has the `abi`/`bytecode` (and, for the
token descriptor, `linkReferences`) fields the script expects.
`@uniswap/v2-periphery`'s `WETH9.json` is an older solc artifact whose
`bytecode` field is plain hex **without** the `0x` prefix, unlike the four
Hardhat-format V3 artifacts; `loadExternalArtifact`'s
`normalizeArtifactBytecodeHex` (`lib/uniswap-v3-artifact-linking.ts`) handles
this automatically, prepending `0x` when it's missing, and separately
tolerates the one unresolved solc library placeholder present in
`NonfungibleTokenPositionDescriptor.json`'s bytecode (linked later via
`linkLibraryReferences`) — so no manual bytecode editing is needed for
either artifact. If a pin ever changes, re-open each artifact file (the
exact paths are constants near the top of `deploy-uniswap-v3-testnet.ts`)
and confirm it still has the fields the script expects —
`loadExternalArtifact` throws a clear error naming the problem if a path is
wrong or a package version's artifact layout has changed in some other way,
rather than deploying something silently broken.

Deploy once per chain:

```bash
npm install
npm run deploy:uniswap-v3:robinhood
```

Required environment variables (set locally, e.g. in `.env.local`; never
commit real values):

| Variable | Purpose |
| --- | --- |
| `ROBINHOOD_TESTNET_RPC_URL` | RPC endpoint used by the Hardhat network. |
| `HOODLUMS_UNISWAP_V3_DEPLOYER_PRIVATE_KEY` | Private key of the funded testnet-only account that sends every deployment transaction. Read only by Hardhat at deploy time; never logged, stored, or committed. |
| `HOODLUMS_UNISWAP_V3_NATIVE_CURRENCY_LABEL` (optional, default `ETH`) | The `NonfungibleTokenPositionDescriptor` native-currency display label (bytes32-encoded, 31 ASCII characters max). |

After deploying, the script itself reads back `factory.owner()` (must equal
the deployer), `positionManager.factory()` (must equal the deployed
factory), and `positionManager.WETH9()` (must equal the deployed WETH9), and
aborts loudly on any mismatch instead of printing addresses that don't
actually work together. On success it prints the three addresses in exactly
the env-var format the deployment drill and curve launch pipeline sections
above read:

```
HOODLUMS_BONDING_CURVE_POSITION_MANAGER_ADDRESS=0x...
HOODLUMS_BONDING_CURVE_UNISWAP_V3_FACTORY_ADDRESS=0x...
HOODLUMS_BONDING_CURVE_WETH9_ADDRESS=0x...
```

**These are OUR testnet-only deployments, not Uniswap's** — they stand in
for the official contracts Robinhood Chain Testnet doesn't have. Replace
them with the official addresses on any chain that documents them (Robinhood
Chain mainnet, 4663, already does — see the table above); never reuse them
outside chain 46630.

**Manual smoke test (do this before relying on the deployment).** The
read-back checks above only prove the three contracts are wired together —
they don't prove `mint()` actually succeeds on this live testnet. Before the
pipeline ceremony depends on it, prove a real mint works end to end:

1. Deploy a throwaway token, e.g. `npm run deploy:factory:robinhood` (or any
   `/testnet` launch) — you only need an ERC-20 balance, it doesn't need to
   be a real launch.
2. Using the printed `UniswapV3Factory`/`NonfungiblePositionManager`
   addresses, either write a short one-off viem/ethers script or use `cast`
   (Foundry) to: `factory.createPool(token, weth9, 3000)` (or let
   `positionManager.createAndInitializePoolIfNecessary` do it in one call
   with an initial `sqrtPriceX96`), then `weth9.deposit{value: ...}()`,
   `approve` both the token and WETH9 to the position manager, and call
   `positionManager.mint(...)` with a small full-range-ish position.
3. Confirm the mint transaction succeeds and returns a non-zero `tokenId` —
   if it reverts, do not point `HOODLUMS_BONDING_CURVE_POSITION_MANAGER_ADDRESS`
   at this deployment; something in the stack above is mismatched.

### Curve launch pipeline deployment

Milestone A (issue #409, Part 1) adds `contracts/HoodlumsCurveLaunchPipeline.sol`,
a small helper that deploys a token AND a `HoodlumsTestBondingCurve` for it in
one transaction, so `/testnet`'s Robinhood Chain flow only needs three wallet
signatures total (deploy token+curve, approve, `fundCurve()`) instead of
separately deploying each contract by hand. It does not modify
`FixedSupplyMemeToken` or `HoodlumsTestBondingCurve` — it only chains their
existing constructors — and it never holds the token or any funds itself.

Deploy it once per chain:

```bash
npm run contracts:compile
npm run deploy:curve-launch-pipeline:robinhood
```

Required environment variables — the same treasury/Uniswap V3 addresses as
the deployment drill above, since every curve this pipeline deploys
graduates the same way:

| Variable | Purpose |
| --- | --- |
| `HOODLUMS_CURVE_LAUNCH_PIPELINE_DEPLOYER_PRIVATE_KEY` | Funded testnet-only deployer key. Never logged, stored, or committed. |
| `HOODLUMS_BONDING_CURVE_TREASURY_ADDRESS` | Constructor `treasury_`, applied to every curve this pipeline deploys. |
| `HOODLUMS_BONDING_CURVE_POSITION_MANAGER_ADDRESS` / `HOODLUMS_BONDING_CURVE_UNISWAP_V3_FACTORY_ADDRESS` / `HOODLUMS_BONDING_CURVE_WETH9_ADDRESS` | Same Uniswap V3 addresses as the deployment drill — re-verify independently before deploying, see the caveats above. |

Once verified, set `NEXT_PUBLIC_HOODLUMS_CURVE_LAUNCH_PIPELINE_ADDRESSES` to
`{"46630":"0xYourDeployedPipeline"}` — `/testnet` only offers the curve-backed
launch path once this is configured; until then it keeps using the existing
factory/direct-deploy token-only path. Each launch's graduation target and
virtual reserves come from `NEXT_PUBLIC_HOODLUMS_CURVE_GRADUATION_TARGET_ETHER`
/ `NEXT_PUBLIC_HOODLUMS_CURVE_VIRTUAL_ETH_RESERVE_ETHER` /
`NEXT_PUBLIC_HOODLUMS_CURVE_VIRTUAL_TOKEN_RESERVE_WHOLE` (defaults `4` / `1` /
`1000000`, matching the deployment drill's own defaults) — a deliberately low
testnet graduation target so a faucet-funded wallet can ride a token to
graduation.

A successful curve-backed launch is also recorded server-side (wallet-signed,
then reconciled against a live on-chain read before being stored — see
`POST /api/token-launches`), the beginning of a `token_launches` table meant
to become the homepage HOODLUMS TOKENS grid's source of truth in a follow-up
PR. Recorded launches are visible today in `/admin`'s Launches section.

### Wallet-signed token test lab

The `/testnet` route supports two proof-of-launch flows:

- **Robinhood Chain Testnet:** add or switch to chain ID `46630`. If a curve launch pipeline is configured for the connected chain (see above), deploying creates the token AND its bonding curve, then funds it — three wallet signatures. Otherwise it deploys through the live HoodlumsTokenFactory (paying its current `0` launch fee) or, if no factory is configured either, deploys a burnable fixed-supply ERC-20 directly. Every path leaves the token with no owner and no external mint function; the complete supply mints once to the signing wallet. Before requesting a signature, the flow compares the wallet app's active account against whichever wallet was last confirmed via the Account panel and warns on a mismatch, offering "switch wallet" or "continue anyway" rather than silently launching under a different owner.
- **Solana devnet:** create an SPL mint and associated token account, mint the selected fixed supply to the connected Phantom wallet, and permanently revoke mint authority.

Both flows return a transaction or token address with an explorer link. Neither flow creates metadata or a public sale. A custom Solana endpoint can be supplied with `NEXT_PUBLIC_SOLANA_DEVNET_RPC`.

The studio's own launch modal (`components/robinhood-testnet-deployment-controller.tsx`, opened from the homepage builder) carries the same wallet-mismatch guard as `/testnet` above, but still only deploys a plain `FixedSupplyMemeToken` — wiring the curve launch pipeline into that flow is left to a follow-up PR.

An additional `/monad` test page deploys the same fixed-supply EVM token design on Monad Testnet and blocks deployment unless the wallet reports chain ID `10143`.

### Social publishing workspace

The `/social` route loads saved projects and provides reusable launch, contract-live, and community announcement drafts. Users can edit and save copy locally, copy it, download project artwork, and open the official X composer for final approval. Telegram publishing goes through the shared Hoodlums bot (`TELEGRAM_BOT_TOKEN`, server-only): the Setup card shows a clear "Not configured" state if that env var is unset, and otherwise a wallet-signed "Connect Telegram" step verifies the bot is actually an admin in the named channel before any post can be sent — there is no free-text bot token or unverified channel field.

### Account status

The `/account` route previews planned Google, GitHub, X, MetaMask, Rabby, and Phantom account options. These controls are currently disabled; wallet connections inside individual launch tools continue to work independently.

### Durable public generated-token sites

Published generated sites are stored in Postgres through the server-only `DATABASE_URL` connection. The browser never receives that connection string, and the application does not create login sessions or user accounts.

- **Database:** `db/migrations/001_public_publishing.sql` creates `published_sites` and `wallet_nonces`. `published_sites.slug` has a database-level unique constraint, so simultaneous requests cannot claim the same path. Generated HTML is capped at 90,000 UTF-8 bytes; artwork is validated by MIME type and magic bytes, capped at 6 MB decoded and 8.1 MB as the stored data-URL reference.
- **Wallet proof:** `POST /api/publish/challenge` creates a cryptographically random nonce, stores only its SHA-256 hash, and returns a five-minute message challenge bound to the exact wallet, slug, wallet chain ID, domain, URI, request ID, expiry, and `publish_generated_site` purpose. The signature is a message signature only—no transaction and no gas.
- **Publish write:** `POST /api/publish` accepts the challenge ID, raw nonce, signature, and site payload. The server locks the nonce row, verifies the EVM signature, rejects expired or replayed challenges, consumes a valid nonce once, sanitises and validates the generated page/artwork, then inserts the site. The owner wallet address comes only from the verified challenge; a client-supplied owner address is rejected.
- **Public read:** `app/[slug]/page.tsx` reads the durable record on every request. Known slugs render in the existing sandboxed iframe with strict CSP and a second sanitisation pass; unknown or invalid slugs keep returning a proper 404. `app/[slug]/artwork/route.ts` serves the validated artwork for Open Graph/Twitter metadata.
- **Platform facts filled at request time:** for free-site pages, the contract address, Dexscreener chart and LP-locked status are never baked into `generated_html`. The free-site template (`docs/free-site-template-source.html`) stores both a themed coming-soon state and a placeholder for each; `lib/free-site-platform-facts.ts` substitutes the current value from the database row (and a live Dexscreener lookup) on every request, so a stored page reflects launch/trading/graduation automatically, with no regeneration and no republish. The Buy button always links to the token's own Hoodlums trade page (`/token/<chain>/<address>`) — the only place a bonding-curve token can be bought, and the page that links on to the locked pool after graduation — never to a Dexscreener search; the contract row links to the chain's block explorer; and the no-pair chart state links to the live Hoodlums chart once the token exists (a Dexscreener embed still takes over automatically when a pair is indexed). `db/migrations/003_lp_locked_at.sql` adds the nullable `lp_locked_at` column this reads from; nothing writes to it yet. User-supplied facts (X, Telegram, website) are unaffected: they are resolved once at generation time and omitted entirely when blank.
- **Rate limiting:** challenge creation and publishing have separate per-IP fixed-window limits in addition to signature verification. These are friction controls, not proof that one wallet or IP equals one person.

Publishing is currently an API workflow; no new publish button or account screen is added by this backend milestone. A client should request a challenge, ask the selected wallet to sign the returned exact `message`, then submit the resulting signature and site payload to `/api/publish`.

#### Database setup

Use the Supabase Postgres connection string only through the server environment:

```bash
DATABASE_URL=postgresql://...              # server only; never NEXT_PUBLIC_
PUBLISH_ALLOWED_ORIGIN=https://hoodlums.dev # optional; falls back to the generation origin or request origin
npm run db:migrate
```

The migration command reads `DATABASE_URL`, applies every SQL file in `db/migrations` in filename order, and never prints the connection string. Apply the migration deliberately before enabling the first production publish. This PR intentionally does not run production migrations automatically.

### Slug rules

`lib/slug.ts` is the single source of truth for website-path rules, shared by the studio save flow, publish endpoint, and public route:

- lowercase ASCII letters, digits and single hyphens only;
- 48 characters maximum;
- no leading/trailing hyphen, no repeated hyphens;
- reserved and rejected outright: `api`, `account`, `testnet`, `providers`, `allocations`, `manager`, `liquidity-lab`, `monad`, `social`, `bonding-curve`, `admin`, `www`.

The browser-local collision check remains a convenience, while the authoritative uniqueness guarantee is the Postgres `published_sites_slug_unique` constraint.

### Capturing the generated design for publishing

`TokenProject` stores optional `generatedSiteHtml`/`generatedSiteVersion` fields. The studio listens for `launchpad:site-generated`, re-validates the generated HTML, and stores it with the local project without scraping the DOM. Changing token identity details clears stale captured HTML. The signed publish endpoint persists only a validated, sanitised copy of the submitted site.

Loading a saved project (or clicking "Reopen generated site" in the preview toolbar) dispatches `launchpad:reopen-generated-site` with that stored `generatedSiteHtml`, and `FullWebsiteGenerator` renders it through the exact same code path as a fresh generation — no AI call, and the inline preview, full-screen toggle, and "Publish draft" payload all read that one value (issue #198).

## Routes

| Route | Purpose | Status |
| --- | --- | --- |
| `/` | Project studio, artwork upload, site generation, and Dexscreener preview | Available |
| `/manager` | Subscriber gateway: wallets with a server-confirmed active subscription see an "Open your Studio" panel linking to `/social`, with the Pro / Pro Bundle plan cards collapsed behind a "View plans" toggle; everyone else sees the plan cards (Monthly / 3-months billing toggle) directly | Available; the launch-flow nav's step-2 tab (issue #248) |
| `/providers` | Robinhood provider handoff, contract verification, and creator-buy tracking | Available; external actions require a provider and wallet. Hidden from the nav (issue #248) — reachable by direct URL only, mechanics unchanged |
| `/allocations` | Allocation planning and wallet-approved testnet distribution | Available. Hidden from the nav (issue #248) — reachable by direct URL only, mechanics unchanged |
| `/liquidity-lab` | Register and fund a separately deployed test AMM | Test-only; nav tab hidden unless `NEXT_PUBLIC_SHOW_TESTNET_TOOLS=true` |
| `/bonding-curve` | Review the full-supply curve and automatic pool-graduation lifecycle, plus live read-only graduation status for a configured curve | Foundation page; live trading not active; nav tab hidden unless `NEXT_PUBLIC_SHOW_TESTNET_TOOLS=true` |
| `/testnet` | Robinhood Chain Testnet and Solana devnet token creation | Test-only |
| `/monad` | Monad Testnet ERC-20 deployment | Test-only |
| `/social` | AI Social Studio: X handoff and Telegram publishing, plus Pro/Pro Bundle-gated voice-profile learning, AI draft generation, mascot scene-image generation, calendar AI drafting, and a Queue tab (issue #352) with a self-refilling "Ready to review" pool, wallet-signed approve-and-schedule against real X/Telegram connections, an "Approved & scheduled" view with cancel and `needs_composer` X hand-off, and sent/failed/canceled History | Available; AI tools require an active Pro/Pro Bundle subscription and, for mascot images, a direct `OPENAI_API_KEY`; posting requires the wallet to have connected X and/or Telegram |
| `/hoodchat` | Live, wallet-signed community chat feed with category filters and per-message reporting | Available after `DATABASE_URL` and migration setup |
| `/account` | Account-provider interface preview | Coming later |
| `/admin` | Private owner-only control panel; System Health and Pages (content CMS) sections | Requires `ADMIN_WALLET_ADDRESS` and/or `ADMIN_PASSWORD`; unauthenticated visitors see only a login screen |
| `/api/publish/challenge` | Create a short-lived single-use wallet message challenge | Available after `DATABASE_URL` and migration setup |
| `/api/publish` | Verify the signature and atomically publish a generated site | Available after `DATABASE_URL` and migration setup |
| `/api/admin/challenge` | Issue a short-lived single-use wallet message challenge for the configured admin wallet | Available after `ADMIN_WALLET_ADDRESS` is set |
| `/api/admin/login` | Verify a wallet signature or the admin password and start a session | Available after `ADMIN_WALLET_ADDRESS` and/or `ADMIN_PASSWORD` is set |
| `/api/admin/logout` | End the current admin session | Available |
| `/api/admin/health` | Live System Health checks (generation, database, contracts, deployment); session-gated | Available |
| `/api/admin/pages` | List registered page content (draft/published/default) and stage a draft edit; session-gated | Available after `DATABASE_URL` and migration setup |
| `/api/admin/pages/actions` | Publish, publish-all, discard, or reset-to-default a page content draft; session-gated | Available after `DATABASE_URL` and migration setup |
| `/api/hoodchat/challenge` | Create a short-lived single-use wallet message challenge for a Hoodchat post | Available after `DATABASE_URL` and migration setup |
| `/api/hoodchat/messages` | List the live Hoodchat feed (GET) or verify a signature and post a message (POST) | GET always available; POST requires `DATABASE_URL` and migration setup |
| `/api/hoodchat/report` | Report a Hoodchat message; auto-hides after 3 reports | Available after `DATABASE_URL` and migration setup |
| `/api/token-chat/challenge` | Create a short-lived single-use wallet message challenge for a per-token chat post | Available after `DATABASE_URL` and migration setup |
| `/api/token-chat/messages` | List a token's chat feed (GET) or verify a signature and post a message (POST) | GET always available; POST requires `DATABASE_URL` and migration setup |
| `/api/token-chat/report` | Report a token chat message; auto-hides after 3 reports | Available after `DATABASE_URL` and migration setup |
| `/api/social/voice-profile` | Build a reusable voice profile (tone, vocabulary, cadence, emoji habits) from pasted example posts | Pro/Pro Bundle-gated; shared-secret + Origin + per-IP rate limiting |
| `/api/social/draft` | Generate an X (≤280 char) and Telegram draft in the taught voice, optionally themed by calendar day | Pro/Pro Bundle-gated; shared-secret + Origin + per-IP rate limiting |
| `/api/social/mascot/visual-dna` | Extract a locked mascot visual identity from an uploaded reference image | Pro/Pro Bundle-gated; shared-secret + Origin + per-IP rate limiting |
| `/api/social/mascot/image` | Generate a mascot scene image from the locked visual identity and a chosen action/place | Pro/Pro Bundle-gated; requires a direct `OPENAI_API_KEY` (unavailable through the Vercel AI Gateway fallback) |
| `/[slug]` | Public generated token site, metadata, artwork and Dexscreener section | Reads durable published records; unknown slugs 404 |
| `/token/[chain]/[address]` | Full three-column trade/chart/holder page for any token by contract address, launched through Hoodlums or not; centre column includes a live Hoodchat tab | No wallet signature/DB write for the page itself; unsupported chains and invalid addresses 404 |

### Any-token trade/chart/holder page

`/token/[chain]/[address]` (`app/token/[chain]/[address]/page.tsx`) is a customer-acquisition page for any token by contract address, whether or not it launched through Hoodlums — "bring your existing token, see it in two minutes." It requires no wallet signature and makes no database write; an unsupported chain segment or an invalid address 404s. Its layout (`components/token-page/`) matches the approved design reference pixel-accurately: a three-column desktop grid (identity + swap / chart + activity / trade terminals + about + chat) that stacks to a single column on mobile, with the swap panel replaced by a sticky bottom bar below 880px.

It reuses the same chart-embed plumbing as `/[slug]` (`PublicDexscreenerSection`, `lib/server/dexscreener.ts`) rather than rebuilding it, so a token with no liquidity yet shows the same clean "no chart yet" state instead of a broken embed. Market cap, liquidity, 24h volume, price, holders and recent trades (`lib/server/token-market-stats.ts`) combine the Robinhood Chain Testnet explorer's public Blockscout API (token identity, holders, market cap, transfers) with the same Dexscreener pair already fetched for the chart (liquidity, volume, price, 24h change) — mirroring `lib/server/token-holders.ts`'s existing LP-exclusion pattern rather than duplicating it. Any source that's unavailable degrades to a plain "—"/empty state instead of a broken page.

The swap panel only shows live buy/sell controls once the single bonding curve configured for the chain (`NEXT_PUBLIC_HOODLUMS_BONDING_CURVE_ADDRESSES`, `lib/bonding-curve-config.ts`) confirms on-chain that its own `token()` matches this page's address — buys call `buy()` directly; sells raise ERC-20 allowance first if needed, then call `sell()`. Both apply a user-selected slippage floor (`lib/bonding-curve-slippage.ts`) and a 10-minute deadline, matching the contract's own guards. Any other case (no curve configured, a curve configured for a different token, or a non-EVM chain) falls back to the referral-coded "trade on terminal" links instead of a dead form.

A row of referral-coded "trade on X" links (`lib/trade-terminal-links.ts`) covers the terminals confirmed to support Robinhood Chain: GMGN, Axiom, Maestro and Ave.ai. Each referral code is read from a `NEXT_PUBLIC_*` var (`NEXT_PUBLIC_GMGN_REF_CODE`, `NEXT_PUBLIC_AXIOM_REF_CODE`, `NEXT_PUBLIC_MAESTRO_REF_CODE`, `NEXT_PUBLIC_AVE_REF_CODE`) — these are PUBLIC config, not secrets, and are unrelated to the server-only `GMGN_API_KEY` used by the `/testnet` trending feed. An unset code still produces a working, un-refcoded link. The exact URL shape for each platform reflects its commonly documented referral convention as of this PR; confirm against each platform's current affiliate program before relying on attribution.

Basic holder stats (`lib/server/token-holders.ts`) come from the Robinhood Chain Testnet explorer's public Blockscout API and exclude the LP pool address (resolved via the same Dexscreener pair lookup as the chart) from the top-holder list, so pooled liquidity is never shown as a whale. Solana holder stats are not wired up yet — that chain resolves to a "not available" state rather than a guess, and shows the trade-terminal fallback instead of a swap form.

There's no stored description for an arbitrary chain/address page (private drafts live in the browser, published sites are keyed by slug, not address), so the "About" panel and the "Crew chat" panel both show honest placeholder states rather than invented copy — chat is a "coming soon" state per the approved design, not a working feature yet.

## Admin dashboard

`/admin` is a private control panel for the platform owner only. It ships in
this PR with the dashboard shell, sign-in, and a System Health section; more
sections (Activity, Money, Issues) can be added later without touching the
shell.

**Signing in.** There are two ways in, and unauthenticated visitors only ever
see a login screen — never dashboard content:

- **Wallet signature (primary).** Same pattern as publishing: the server
  issues a short-lived single-use nonce, you sign a message with the wallet
  set in `ADMIN_WALLET_ADDRESS`, and the server verifies the signature. No
  gas, no transaction. Any other wallet is rejected.
- **Password (fallback).** For access away from that wallet (e.g. from a
  phone). Reads `ADMIN_PASSWORD`, compares it in constant time, and rate-limits
  attempts. The password is never logged.

Both env vars are optional independently — set one, both, or neither (which
disables that login path entirely and returns a 503 from the corresponding
endpoint rather than silently accepting anything).

**System Health.** Four independent, colour-coded (green/amber/red) checks,
polled from `/api/admin/health` once signed in:

- **Website generation** — is an AI generation provider configured? (checks
  configuration only, never spends money on a real call)
- **Database** — does `SELECT 1` succeed against `DATABASE_URL`?
- **On-chain contracts** — do the configured factory and bonding curve
  respond to a read call on Robinhood Chain Testnet?
- **Deployment** — is this server process serving requests, and (in
  production) does it have Vercel deployment metadata?

Each check fails independently: a red database doesn't affect the contracts
check or take down the page.

**Operations (cost/margin cockpit, issue #368).** Answers "am I making
money?" in one place: today/this-month/last-month cards (estimated AI + X
variable cost, prorated fixed cost, verified plan revenue, estimated margin),
a this-month feature breakdown, attributed-vs-unattributed spend
reconciliation with a bounded top-wallets table, a live reverse-chronological
activity ledger, and a fixed-operating-cost editor (add/edit/delete,
monthly/annual cadence). Every paid AI provider attempt is metered from its
own returned usage (never a prompt-length estimate) against configurable unit
prices (`OPENAI_INPUT_COST_USD_PER_MILLION` and siblings — see
`.env.example`) and stored in `ai_operation_costs`
(migration `022_operations_costs.sql`); X send costs are read from the
existing `social_x_send_costs` table rather than duplicated. Every figure is
explicitly labelled as an estimate, not the provider invoice — reconcile
against the real OpenAI/X bill weekly during launch/active testing and at
least monthly once stable. A fifth System Health check, **Operations cost**,
reports this month's estimated spend against configurable amber/red
thresholds (`OPERATIONS_MONTHLY_COST_AMBER_USD` /
`OPERATIONS_MONTHLY_COST_RED_USD`).

**Pages (content CMS).** A lightweight, draft-first content editor for
registered public-page chrome — headings, copy, button labels/links and
section visibility toggles. Backed by the durable `page_content_entries`
table (migration `006_page_content_registry.sql`; see
`lib/page-content-registry.ts` for the registered pages/elements):

- Edits save as a **draft** first — nothing goes live until an admin clicks
  **Publish** (or **Publish all drafts** for a page). **Discard draft** drops
  a pending edit; **Reset to default** stages the original hardcoded value
  back into a draft so it goes through the same preview step.
- **Preview** opens the real public page with drafts applied, gated by
  `?cms_preview=1` plus the same durable admin session cookie every other
  admin action requires — the flag is silently ignored for anyone without a
  live session, so a draft is never visible to the public.
- The public read path always falls back to the page's hardcoded default if
  the registry has no published value for an element, or if the database is
  unreachable — content editing can never take a page down.
- Submitted values are sanitised server-side (HTML tags stripped from text;
  links limited to a site-relative path or an `https://` URL) before they are
  ever staged as a draft, and every publish is recorded in the Activity log
  with the old and new value.
- **Currently registered:** `/` (hero copy and its two CTAs), `/providers`
  (header copy and the "Back to studio" label), `/manager` (header copy for
  the Pro / Pro Bundle plan cards), `/allocations` (header copy plus the
  liquidity-lab CTA), `/account` (header copy, section titles, and each
  sign-in provider's descriptive note), `/bonding-curve` (hero copy,
  next-milestone section and its two CTAs), and the public `/[slug]` token
  page's Dexscreener chrome. Home, Providers, Manager and Allocations resolve
  this content server-side at the page-chrome level and pass it down as plain
  props into the large stateful client components that own the rest of each
  page (`HoodlumsMarketHome`, `ProviderLauncher`, `ManagerGateway`,
  `TokenAllocationDesk`) — those components' internal state, wallet flows and
  effects are never restructured, so a bad edit can never destabilise the
  primary mobile-Safari workspace. The sign-in provider *names* themselves
  (Google, MetaMask, etc.) are intentionally not editable, since they select
  each row's logo and CSS class.

## Safety model and limitations

- The application never requests or stores a seed phrase or private key.
- Publishing uses a per-request EVM message signature; it creates no login session and sends no blockchain transaction.
- Blockchain transactions elsewhere require explicit approval in the connected wallet.
- Mainnet deployment is not exposed by the studio or test lab.
- Testnet actions spend test ETH, test MON, or devnet SOL and do not create a market by themselves.
- Private project drafts remain browser-local and are not an encrypted vault or hosted backup.
- Only explicitly published site records are durable. There is no account-based dashboard, private cross-device draft sync, ownership transfer, update, or deletion flow in this milestone.
- Artwork is stored as a validated, size-capped data-URL reference in Postgres for this milestone; dedicated object storage is not yet implemented.
- The publish signature proves control of the selected EVM wallet for that one request. Wallet addresses are free to create, so this is authorisation for a site—not proof of a unique human identity.
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

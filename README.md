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

Project records and generated-site state are local to the current browser; cross-device accounts and hosted project synchronization are not active yet.

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

The `/bonding-curve` route is the fifth launch-workflow page. It explains the approved full-supply launch model, wallet-signed curve trading, the graduation target, automatic Hoodlums pool creation, and permanent initial LP locking. The bonding-curve contract foundation is merged, but it is not deployed or connected to live buy/sell controls yet.

### Factory deployment (prep only)

`contracts/HoodlumsTokenFactory.sol` is merged but **not yet deployed**. A
Hardhat script prepares — but does not run — a deployment to Robinhood Chain
Testnet:

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
does not touch the `/testnet` UI, does not update
`NEXT_PUBLIC_HOODLUMS_FACTORY_ADDRESSES`, and is never run automatically —
running it is a deliberate, owner-initiated action.

Once a deployment is verified, the frontend can read its address through
`lib/factory-config.ts`, which exposes the factory ABI and reads a per-chain
address map from `NEXT_PUBLIC_HOODLUMS_FACTORY_ADDRESSES` (public JSON, e.g.
`{"46630":"0xYourDeployedAddress"}`).

### Wallet-signed token test lab

The `/testnet` route supports two proof-of-launch flows:

- **Robinhood Chain Testnet:** add or switch to chain ID `46630`, deploy a burnable fixed-supply ERC-20, and mint the complete supply once to the signing wallet. The contract has no owner or external mint function.
- **Solana devnet:** create an SPL mint and associated token account, mint the selected fixed supply to the connected Phantom wallet, and permanently revoke mint authority.

Both flows return a transaction or token address with an explorer link. They do not create metadata, liquidity, a bonding curve, or a public sale. A custom Solana endpoint can be supplied with `NEXT_PUBLIC_SOLANA_DEVNET_RPC`.

An additional `/monad` test page deploys the same fixed-supply EVM token design on Monad Testnet and blocks deployment unless the wallet reports chain ID `10143`.

### Social publishing workspace

The `/social` route loads saved projects and provides reusable launch, contract-live, and community announcement drafts. Users can edit and save copy locally, copy it, download project artwork, open the official X composer for final approval, and publish to Telegram with their own bot token and channel ID. Telegram bot tokens are submitted only for the requested post, cleared from the form afterward, and are not stored in browser project data.

### Account status

The `/account` route previews planned Google, GitHub, X, MetaMask, Rabby, and Phantom account options. These controls are currently disabled; wallet connections inside individual launch tools continue to work independently.

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

## Safety model and limitations

- The application never requests or stores a seed phrase or private key.
- Blockchain transactions require explicit approval in the connected wallet.
- Mainnet deployment is not exposed by the studio or test lab.
- Testnet actions spend test ETH, test MON, or devnet SOL and do not create a market by themselves.
- Browser-local project data is not an encrypted vault or a hosted backup.
- The platform does not yet provide hosted image/metadata storage, automatic site publishing, domains, audited vesting, or production liquidity management.
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

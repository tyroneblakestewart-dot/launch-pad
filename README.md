# Private Meme Token Studio

A private, non-custodial workspace for preparing meme-token launches on Solana and Robinhood Chain, generating an artwork-matched landing page and testing wallet-signed token creation.

## Working MVP

- Create, save, load, delete and export token projects in the browser
- Choose Solana or Robinhood Chain
- Upload token artwork up to 20 MB with automatic browser optimisation
- Generate a landing-page palette, layout, mood and copy from the uploaded artwork
- Use OpenAI vision for deeper artwork analysis when `OPENAI_API_KEY` is configured
- Fall back to private browser-side colour and composition analysis when no AI key is present
- Configure token name, ticker, supply, decimals, website path and optional socials
- Detect Phantom and EVM browser wallets
- Prepare a launch summary while keeping mainnet deployment blocked in the studio
- Open `/testnet` to create wallet-signed test tokens

## Artwork-driven website generator

The **Generate site from artwork** step is enabled after the token name, ticker and description are complete. It uses the uploaded image as the primary design reference and chooses between split, poster, gallery and minimal layouts. Generated sites replace the fixed Hoodlums copy and styling with project-neutral content.

The generator works without an external API by analysing the image in the browser. For deeper vision analysis, add these server-side Vercel environment variables:

```bash
OPENAI_API_KEY=your_server_side_key
OPENAI_VISION_MODEL=gpt-5-mini
```

Never expose `OPENAI_API_KEY` through a `NEXT_PUBLIC_` variable.

## Testnet launcher

### Robinhood Chain testnet

- Adds or switches the wallet to chain ID `46630`
- Deploys a fixed-supply, burnable ERC-20
- Mints the complete supply to the signing wallet
- Has no owner and no external mint function
- Returns the contract address and testnet explorer link

### Solana devnet

- Creates an SPL token mint and associated token account
- Mints the selected fixed supply to the connected Phantom wallet
- Permanently revokes mint authority after minting
- Returns the mint address and devnet explorer link

## Safety model

- Never request or store a seed phrase or private key
- All blockchain actions are signed in the user's wallet
- The OpenAI key, when used, remains server-side
- The testnet page explicitly requires test funds
- Mainnet token deployment, liquidity and bonding curves remain disabled
- Always complete both testnet flows before enabling a reviewed mainnet switch

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the studio and `http://localhost:3000/testnet` for the test lab.

## Validation

GitHub Actions runs ESLint and a production Next.js build on every branch update and pull request.

## Remaining before a production launch

- Execute and verify one Robinhood Chain testnet deployment
- Execute and verify one Solana devnet mint
- Add hosted image and token metadata storage
- Add automatic website publishing and a real domain
- Add explicit mainnet review, transaction simulation and confirmation guards
- Decide how liquidity will be created and managed

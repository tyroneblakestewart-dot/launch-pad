# Private Meme Token Studio

A private, non-custodial workspace for preparing meme-token launches on Solana and Robinhood Chain, generating a matching landing page and testing wallet-signed token creation.

## Working MVP

- Create, save, load, delete and export token projects in the browser
- Choose Solana or Robinhood Chain
- Upload token artwork and preview a reusable HOODLUMS-style landing page
- Configure token name, ticker, supply, decimals, website path and socials
- Detect Phantom and EVM browser wallets
- Prepare a launch summary while keeping mainnet deployment blocked in the studio
- Open `/testnet` to create wallet-signed test tokens

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

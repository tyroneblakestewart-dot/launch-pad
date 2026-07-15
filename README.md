# Private Meme Token Studio

A private, non-custodial workspace for preparing meme-token launches on Solana and Robinhood Chain and generating a matching landing page and social launch pack.

## 48-hour MVP scope

- Create and save token projects locally in the browser
- Choose Solana or Robinhood Chain
- Upload token artwork and preview a reusable HOODLUMS-style landing page
- Generate contract-address, website and social placeholders
- Detect browser wallets and prepare for wallet-signed transactions
- Keep all launch actions disabled until network-specific transaction adapters have been tested

## Safety model

- Never request or store a seed phrase or private key
- All blockchain actions must be signed in the user's wallet
- Mainnet launches remain opt-in and must show a final transaction summary
- Test on Solana devnet and Robinhood Chain testnet first

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Status

The initial branch contains the private dashboard, project form, browser persistence and live landing-page preview. Wallet-signed token deployment adapters are the next milestone.

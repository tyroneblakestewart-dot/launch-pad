# Verified plan payments

Paid plan access is fail-closed. The browser sends a direct ETH transfer from the user's confirmed EIP-6963 wallet, but the browser never decides that access is paid. After the transaction is submitted, the same wallet signs a plain-text proof tied to the site origin, plan and transaction hash. That signature sends no funds. `/api/plan-payments/verify` verifies the payer signature, then independently reads the transaction and receipt from the configured Robinhood Chain RPC, checks the RPC chain ID, sender, treasury recipient, direct-transfer calldata, value, successful receipt and confirmation count, and records the transaction in Postgres before returning an unlock response.

A public transaction hash by itself is not sufficient to claim an unlock from another browser: the request must also include a valid signature from the wallet that sent the payment.

## Database

Apply migrations in order, including:

```text
db/migrations/007_subscriptions.sql
db/migrations/008_plan_payments.sql
```

`subscriptions` remains the current one-row-per-wallet entitlement used by **Admin → Subscribers**. `plan_payment_events` is the immutable transaction-hash-unique revenue ledger used by **Admin → Money** and the admin activity stream.

## Required server environment

Never commit real treasury or RPC values.

```bash
DATABASE_URL=postgres://...
HOODLUMS_TREASURY_ADDRESS=0x...
HOODLUMS_PAYMENT_RPC_URL=https://...
HOODLUMS_PAYMENT_CHAIN_ID=46630
HOODLUMS_PAYMENT_CHAIN_NAME="Robinhood Chain Testnet"
HOODLUMS_PAYMENT_EXPLORER_URL=https://explorer.testnet.chain.robinhood.com

# Exact server-controlled ETH prices in wei. Update these values when the
# desired ETH equivalent of the advertised USD prices changes.
HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI=...
HOODLUMS_PRO_AMOUNT_WEI=...
HOODLUMS_PRO_BUNDLE_AMOUNT_WEI=...
```

The USD product prices are fixed at $10, $50 and $120 in code and in the revenue ledger. The exact ETH transfer values are server configuration rather than client input. This repository does not guess an exchange rate or trust an unsigned browser quote. Production deployment must set the wei amounts to the approved ETH equivalents before enabling checkout.

The existing same-origin configuration used by state-changing endpoints must also match the deployment origin (`ADMIN_ALLOWED_ORIGIN`, `PUBLISH_ALLOWED_ORIGIN`, or `GENERATE_SITE_STYLE_ALLOWED_ORIGIN`). The wallet proof includes that origin, so a signature produced for one deployment origin cannot be reused against another.

## Access rules

- Bond and Bond + Site: no payment request; builder opens immediately.
- Bond + Pro Site: verified one-off payment; builder opens only after wallet-proof verification, on-chain verification and database recording all succeed.
- Pro: verified payment creates or extends an active entitlement by 30 days.
- Pro Bundle: same as Pro, with tier `pro_bundle` and up to three tokens.
- A transaction hash can be recorded once. Retrying verification for the same wallet and plan is idempotent; attempting to reuse it for another wallet or plan is rejected.
- If a payment is sent but the proof-signature step is cancelled, retry asks only for the signature and reuses the existing transaction hash. It cannot send the payment a second time.

Recurring billing is deliberately not implemented. Each accepted Pro or Pro Bundle payment extends an existing future expiry by another 30 days, or starts 30 days from confirmation when no active period remains.

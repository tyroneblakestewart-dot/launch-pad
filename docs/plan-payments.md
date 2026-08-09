# Verified plan payments and subscription lifecycle

Paid access is fail-closed. The browser may request a wallet transaction, but only the server can decide that a plan is paid or active. The server verifies wallet ownership, Robinhood Chain, the selected payment-token contract, on-chain decimals, exact ERC-20 calldata, the matching `Transfer` event and the transaction-hash replay boundary before writing Postgres or returning an unlock response.

## Robinhood Chain network

Subscription payments target **Robinhood Chain mainnet**:

- Chain ID: `4663`
- Native gas token: ETH
- Public RPC: `https://rpc.mainnet.chain.robinhood.com`
- Official explorer: `https://robinhoodchain.blockscout.com`

Chain ID `46630` is Robinhood Chain testnet and must not be used for live subscription payments.

## Verified stablecoins

### USDG — enabled

- Symbol: `USDG`
- Issuer: Paxos / Global Dollar
- Robinhood Chain contract: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- Decimals: `6`
- Status: enabled

Primary verification sources:

- Paxos network-address documentation: `https://docs.paxos.com/guides/stablecoin/usdg/mainnet`
- Official Robinhood Chain explorer: `https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`

The official explorer shows active USDG transfers/swaps and substantial balances on major Robinhood Chain contracts. The server still reads `decimals()` on-chain for every payment before accepting it.

### USDT — configured but disabled

No canonical Tether-issued or materially liquid bridged USDT contract was verified on the official Robinhood Chain explorer during the implementation review. USDT remains in the token list as disabled with no contract address, so it cannot appear in checkout or unlock a subscription. Enable it only after independently verifying an authentic contract, holder distribution and meaningful liquidity.

## Multi-token configuration

Use one server-only JSON environment variable. Never prefix it with `NEXT_PUBLIC_`.

```bash
HOODLUMS_PAYMENT_TOKENS_JSON='[
  {
    "symbol":"USDG",
    "contractAddress":"0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    "decimals":6,
    "enabled":true,
    "note":"Paxos-issued Global Dollar on Robinhood Chain mainnet"
  },
  {
    "symbol":"USDT",
    "contractAddress":null,
    "decimals":null,
    "enabled":false,
    "note":"Disabled: no canonical liquid USDT contract verified on Robinhood Chain"
  }
]'
```

Rules:

- Symbols are normalised to uppercase and must be unique.
- Every enabled token requires a valid contract address and configured decimals.
- Every disabled token requires a reason.
- At least one token must be enabled.
- Only enabled tokens are returned to the checkout UI.
- Configured decimals are checked against the token contract on-chain before payment acceptance.
- The selected token is included in the wallet proof, so a signature for USDG cannot be reused for another token.

The former `HOODLUMS_USDT_TOKEN_ADDRESS` and `HOODLUMS_USDT_DECIMALS` variables are supported only as a temporary backwards-compatible fallback when `HOODLUMS_PAYMENT_TOKENS_JSON` is absent. New deployments must use the JSON list.

## Required payment environment

```bash
DATABASE_URL=postgres://...

HOODLUMS_TREASURY_ADDRESS=0x...
HOODLUMS_PAYMENT_RPC_URL=https://rpc.mainnet.chain.robinhood.com
HOODLUMS_PAYMENT_CHAIN_ID=4663
HOODLUMS_PAYMENT_CHAIN_NAME="Robinhood Chain"
HOODLUMS_PAYMENT_EXPLORER_URL=https://robinhoodchain.blockscout.com
HOODLUMS_PAYMENT_TOKENS_JSON='[...]'
HOODLUMS_APP_ORIGIN=https://hoodlums.dev

# Optional comma-separated additional production/payment origins.
HOODLUMS_PAYMENT_ALLOWED_ORIGINS=

# Keep false/unset in normal deployments. Setting true allows a Vercel preview
# to request a REAL wallet payment after its preflight passes.
HOODLUMS_PAYMENT_ALLOW_VERCEL_PREVIEWS=false

# Bond + Pro Site only: exact one-off ETH price in wei.
HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI=...
```

## Payment origin safety

Payment verification no longer reuses the admin-login origin policy. Payments have their own allowlist and a dedicated `POST /api/plan-payments/preflight` safety check.

- Production same-origin requests and `HOODLUMS_APP_ORIGIN` are allowed.
- Additional approved origins can be supplied with `HOODLUMS_PAYMENT_ALLOWED_ORIGINS`.
- New real payments from Vercel previews are blocked by default.
- Preview sends require the explicit `HOODLUMS_PAYMENT_ALLOW_VERCEL_PREVIEWS=true` opt-in.
- Preview verification/recovery is allowed for that preview's own origin because it cannot request a new transfer. It still requires the exact on-chain payment and a fresh wallet signature bound to the current origin.
- Checkout runs preflight while loading and again immediately before `eth_sendTransaction`. A rejected origin therefore cannot move funds and then discover only afterward that verification is forbidden.

## Recovering an existing payment

A confirmed on-chain transfer must never be stranded just because signing, networking, origin policy or server verification fails afterward.

As soon as the wallet returns a transaction hash, checkout saves a recovery record in browser local storage **before** requesting the wallet proof or calling the verification API. The recovery record contains the plan, billing choice, token, paying wallet, transaction hash, amount, chain and timestamp. It never stores the wallet signature.

The checkout exposes **Recover an existing payment**:

1. Select the same plan, billing period and payment token used by the original transfer.
2. Paste the existing transaction hash (or use the locally saved hash when available).
3. Connect the wallet that sent the payment.
4. Sign a fresh proof for the current origin. This signature sends no funds.
5. The server rechecks the original transaction's chain, sender, token contract, decimals, exact treasury calldata, amount and matching `Transfer` event, then applies normal replay protection and records the subscription.

The recovery path never calls `eth_sendTransaction`, so retrying a failed activation cannot create a second payment. After any post-transfer failure the UI explicitly tells the user **Do not pay again**, keeps the hash visible/recoverable and offers the recovery action.

## Subscription prices

The dollar price is unchanged whichever enabled stablecoin is selected.

| Plan | Billing choice | Dollar price | Access window |
| --- | --- | ---: | ---: |
| Pro | Monthly | $50 | 32 days |
| Pro | 3 months upfront | $120 | 96 days |
| Pro Bundle | Monthly | $120 | 32 days |
| Pro Bundle | 3 months upfront | $288 | 96 days |

There is no automatic charging. Renewing before expiry extends from the current `paid_until`; renewing after expiry starts a fresh window from the confirmed payment time.

## Server verification

For each stablecoin payment the server requires all of the following:

- wallet proof bound to origin, plan, billing period, selected token and transaction hash;
- RPC chain ID equals the configured Robinhood Chain ID;
- successful transaction receipt and required confirmation;
- transaction sender equals the signed wallet;
- transaction target equals the selected token contract;
- `decimals()` equals the configured token decimals;
- zero native ETH value;
- calldata decodes as `transfer(treasury, exactAmount)`;
- receipt contains the matching token `Transfer` event from payer to treasury;
- transaction hash has not already been used for another wallet, plan, billing period or payment token.

A public transaction hash alone is never enough to claim access.

## Database and admin

The existing schema already stores token-aware payment history:

- `plan_payment_events.asset_symbol`
- `plan_payment_events.asset_contract`
- `plan_payment_events.amount_atomic`
- `plan_payment_events.amount_display`
- `subscriptions.last_payment_asset`
- `subscriptions.last_payment_amount`

No new migration is required for multi-token support or transaction-hash recovery.

- **Admin → Money** displays the token symbol for every revenue event.
- **Admin → Subscribers** displays the token used for the latest payment and in payment history.
- The transaction hash remains the primary replay boundary across all accepted tokens.

## Telegram and renewal lifecycle

The 32/96-day lifecycle, active/expiring/expired states, in-app banners, Telegram linking, daily cron and retained-data behaviour are unchanged. See `docs/subscription-lifecycle-review.md` for the deployment and test checklist.

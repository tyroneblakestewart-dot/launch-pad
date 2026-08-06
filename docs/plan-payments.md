# Verified plan payments and subscription lifecycle

Paid access is fail-closed. The browser can request a wallet transaction, but it never decides that a plan is paid or active. After the transaction is submitted, the paying wallet signs a plain-text proof tied to the site origin, plan, billing period and transaction hash. The signature sends no funds. `/api/plan-payments/verify` verifies wallet ownership, independently reads the transaction and receipt from the configured Robinhood Chain RPC, validates the configured chain and payment details, and records the result in Postgres before returning an unlock response.

A public transaction hash is not sufficient to claim an unlock: the request must also include a valid signature from the wallet that sent the payment.

## Payment assets

- **Bond + Pro Site:** one-off ETH transfer to the configured treasury. The exact wei amount is server configuration.
- **Pro:** USDT ERC-20 transfer to the configured treasury.
- **Pro Bundle:** USDT ERC-20 transfer to the configured treasury.

For USDT subscriptions, verification requires all of the following:

- the RPC reports the configured Robinhood Chain ID;
- the transaction succeeded and has the required confirmation;
- the transaction sender matches the signed wallet;
- the transaction target is the configured USDT contract;
- the token contract's on-chain decimals match `HOODLUMS_USDT_DECIMALS`;
- calldata decodes as `transfer(treasury, exactAmount)`;
- no native currency is sent with the token transfer;
- the receipt contains the matching USDT `Transfer` event from the paying wallet to the treasury;
- the transaction hash has not been used for another wallet, plan or billing period.

## Manual-renewal windows

There is no automatic charging.

| Plan | Billing choice | USDT payment | Access window |
| --- | --- | ---: | ---: |
| Pro | Monthly | $50 | 32 days |
| Pro | 3 months upfront | $120 | 96 days |
| Pro Bundle | Monthly | $120 | 32 days |
| Pro Bundle | 3 months upfront | $288 | 96 days |

The upfront option is 20% below three separate monthly payments.

- Renewing before expiry extends from the current `paid_until` value.
- Renewing after expiry starts a new window from the confirmed payment time.
- An expired payment returns the subscription to active without deleting any project or generated-site data.

Lifecycle state is derived server-side from `paid_until`:

- `active`: more than five days remain;
- `expiring`: five days or less remain;
- `expired`: `paid_until` has passed. Subscription features are disabled, but data is retained.

`getSubscriptionAccess()` and `isSubscriptionActive()` in `lib/server/subscription-lifecycle.ts` are the single server-side entitlement source. Subscription features must not use a browser-only flag.

## Database

Apply migrations in order, including:

```text
db/migrations/007_subscriptions.sql
db/migrations/008_plan_payments.sql
db/migrations/009_subscription_lifecycle.sql
```

- `subscriptions` stores each wallet's current plan, lifecycle state, `paid_from`, `paid_until` and optional Telegram link.
- `plan_payment_events` is the immutable transaction-hash-unique payment history used by **Admin → Money** and **Admin → Subscribers**.
- `subscription_lifecycle_runs` records each daily cron execution.
- `subscription_reminder_events` records each reminder attempt and prevents duplicate sends for the same wallet, expiry and reminder day.
- `telegram_link_codes` stores short-lived, one-time wallet-to-Telegram link codes.

Expired subscriptions are updated in place. No subscription data, payment history, generated site or saved project is deleted by lifecycle processing.

## Required server environment

Never commit real treasury, token, RPC or bot values.

```bash
DATABASE_URL=postgres://...

HOODLUMS_TREASURY_ADDRESS=0x...
HOODLUMS_PAYMENT_RPC_URL=https://...
HOODLUMS_PAYMENT_CHAIN_ID=46630
HOODLUMS_PAYMENT_CHAIN_NAME="Robinhood Chain"
HOODLUMS_PAYMENT_EXPLORER_URL=https://...

# Bond + Pro Site only: exact one-off ETH price in wei.
HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI=...

# Subscription token configuration. Decimals are checked against the contract.
HOODLUMS_USDT_TOKEN_ADDRESS=0x...
HOODLUMS_USDT_DECIMALS=6

# Vercel cron authentication.
CRON_SECRET=...

# Optional Telegram reminders. In-app reminders continue without these.
TELEGRAM_BOT_TOKEN=123456:...
TELEGRAM_BOT_USERNAME=HoodlumsBot
TELEGRAM_WEBHOOK_SECRET=...

# Used in reminder links. Defaults to https://hoodlums.dev.
HOODLUMS_APP_ORIGIN=https://hoodlums.dev
```

The existing allowed-origin configuration must also match the deployment origin. The wallet proof contains that origin, so a signature produced for one deployment cannot be replayed against another.

## Telegram linking

After a successful Pro or Pro Bundle payment, the confirmation screen offers **Link Telegram for renewal reminders** when the bot is configured.

1. The server creates a random one-time code that expires after 30 minutes.
2. The user opens `https://t.me/<bot>?start=<code>`.
3. Telegram sends the `/start` update to `/api/telegram/subscription-webhook`.
4. The webhook requires Telegram's `X-Telegram-Bot-Api-Secret-Token` header to match `TELEGRAM_WEBHOOK_SECRET`.
5. The server consumes the code once and stores the Telegram user/chat ID against the paying wallet's subscription.

Configure the Telegram webhook with the route above and the same secret token. The bot token is only used server-side.

## Reminders and cron

`vercel.json` runs `/api/cron/subscription-lifecycle` daily at 09:00 UTC. Vercel supplies `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is configured.

The daily job:

- updates stored lifecycle states;
- sends Telegram reminders five days before expiry, two days before expiry and on/after the expiry day;
- records reminder attempts and failures idempotently;
- records the run totals in `subscription_lifecycle_runs`;
- writes successful reminder events to the admin activity log.

In-app reminders do not depend on the cron's stored status. The global banner requests the current server-derived state for the connected wallet and appears from five days remaining or after expiry.

The **Subscribers** drill-down in **Admin → System Health** shows migration readiness, cron/Telegram configuration, the last lifecycle run and the most recent Telegram reminder result.

## Admin cockpit

- **Admin → Subscribers:** current plan, active/expiring/expired state, paid window, Telegram-link state and full verified payment history.
- **Admin → Money:** every verified revenue event with the correct asset (ETH or USDT), billing period and paid window.
- **Admin → Activity:** verified payments and successful Telegram reminder sends.
- **Admin → System Health → Subscribers:** lifecycle tables, last cron run and latest reminder result.

## Retry safety

If a transaction is submitted but signing or confirmation is interrupted, retry reuses the existing transaction hash. It does not call `eth_sendTransaction` again. A recorded hash is idempotent only for the same wallet, plan and billing period; any other reuse is rejected.

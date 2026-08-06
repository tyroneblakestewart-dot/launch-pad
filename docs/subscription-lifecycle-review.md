# Subscription lifecycle review checklist

This change handles real-value payment verification and must remain unmerged until the owner reviews it and completes a real-wallet test with an enabled stablecoin on Robinhood Chain mainnet.

## Before deployment

- Apply migrations through `011_plan_payments.sql`; the runner preserves its legacy dependency position before `010_subscription_lifecycle.sql`.
- Confirm `hoodlums_schema_migrations` records `011_plan_payments.sql`. Existing databases with the old `008_plan_payments.sql` schema are remapped without re-running the payment SQL.
- Configure the treasury and Robinhood Chain mainnet RPC with chain ID `4663`.
- Configure `HOODLUMS_PAYMENT_TOKENS_JSON` with at least one enabled, independently verified token.
- Keep USDG enabled only at the Paxos-published Robinhood contract `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, with six configured decimals and on-chain decimals verification.
- Keep USDT disabled until a canonical, materially liquid Robinhood Chain contract is independently verified.
- Configure `CRON_SECRET` for Vercel cron authentication.
- Optionally configure the Telegram bot username, token and webhook secret.
- Register `/api/telegram/subscription-webhook` with Telegram using the configured webhook secret.

## Payment test matrix

- Pro monthly: $50 in each enabled stablecoin, 32 days.
- Pro upfront: $120 in each enabled stablecoin, 96 days.
- Pro Bundle monthly: $120 in each enabled stablecoin, 32 days.
- Pro Bundle upfront: $288 in each enabled stablecoin, 96 days.
- Checkout lists enabled tokens only.
- Changing token refreshes the server quote before a transaction is sent.
- The wallet proof is bound to the selected token symbol.
- Wrong chain, sender, token contract, treasury, decimals, amount, calldata or Transfer log fails closed.
- A transaction hash recorded for one token cannot activate another token or plan.
- Retrying a submitted hash never sends a second transaction.
- Admin Money and Subscribers show the recorded token symbol.

## Lifecycle test matrix

- Active remains unlocked.
- Five days remaining becomes expiring and shows the global banner.
- Expired disables subscription features while retaining data.
- Daily cron updates stored state.
- Telegram reminders are sent at five days, two days and expiry only when linked.
- Missing Telegram configuration leaves in-app reminders working.
- Admin Subscribers, Money, Activity and System Health show the new events.

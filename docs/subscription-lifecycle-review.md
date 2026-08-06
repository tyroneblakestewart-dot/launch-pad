# Subscription lifecycle review checklist

This change handles real-value payment verification and must remain unmerged until the owner reviews it and completes a real-wallet test with the approved Robinhood Chain USDT contract.

## Before deployment

- Apply migrations through `010_subscription_lifecycle.sql`.
- Configure the treasury, Robinhood Chain RPC and approved USDT contract/decimals.
- Configure `CRON_SECRET` for Vercel cron authentication.
- Optionally configure the Telegram bot username, token and webhook secret.
- Register `/api/telegram/subscription-webhook` with Telegram using the configured webhook secret.

## Payment test matrix

- Pro monthly: 50 USDT, 32 days.
- Pro upfront: 120 USDT, 96 days.
- Pro Bundle monthly: 120 USDT, 32 days.
- Pro Bundle upfront: 288 USDT, 96 days.
- Early renewal extends from current `paid_until`.
- Expired renewal starts from confirmed payment time.
- Wrong chain, sender, token, treasury, decimals, amount, calldata or Transfer log fails closed.
- Retrying a submitted hash never sends a second transaction.

## Lifecycle test matrix

- Active remains unlocked.
- Five days remaining becomes expiring and shows the global banner.
- Expired disables subscription features while retaining data.
- Daily cron updates stored state.
- Telegram reminders are sent at five days, two days and expiry only when linked.
- Missing Telegram configuration leaves in-app reminders working.
- Admin Subscribers, Money, Activity and System Health show the new events.

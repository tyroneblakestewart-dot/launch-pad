-- Cost-efficient support lookups for Admin -> Accounts.
-- No new logging or record tables: these indexes only accelerate reads from
-- records the product already stores.
BEGIN;

CREATE INDEX IF NOT EXISTS subscriptions_wallet_lower_idx
  ON subscriptions (LOWER(wallet_address));

CREATE INDEX IF NOT EXISTS subscriptions_telegram_username_lookup_idx
  ON subscriptions ((LOWER(telegram_username)) text_pattern_ops)
  WHERE telegram_username IS NOT NULL;

CREATE INDEX IF NOT EXISTS plan_payment_events_wallet_lower_confirmed_idx
  ON plan_payment_events (LOWER(wallet_address), confirmed_at DESC);

CREATE INDEX IF NOT EXISTS subscription_reminder_events_wallet_lower_attempted_idx
  ON subscription_reminder_events (LOWER(wallet_address), attempted_at DESC);

CREATE INDEX IF NOT EXISTS published_sites_owner_lower_created_idx
  ON published_sites (LOWER(owner_wallet_address), created_at DESC);

CREATE INDEX IF NOT EXISTS hoodchat_messages_wallet_lower_created_idx
  ON hoodchat_messages (LOWER(wallet_address), created_at DESC);

CREATE INDEX IF NOT EXISTS token_chat_messages_wallet_lower_created_idx
  ON token_chat_messages (LOWER(wallet_address), created_at DESC);

COMMIT;

-- Full manual-renewal lifecycle for Pro and Pro Bundle subscriptions.
-- Keeps all existing rows and legacy ETH payment columns while adding generic
-- payment-asset fields for USDT, 32/96-day windows, Telegram links and
-- idempotent reminder/run history.
BEGIN;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'expiring', 'expired'));

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS paid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_payment_asset VARCHAR(16),
  ADD COLUMN IF NOT EXISTS last_payment_amount VARCHAR(64),
  ADD COLUMN IF NOT EXISTS last_payment_usd_cents INTEGER,
  ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT,
  ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(64),
  ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMPTZ;

UPDATE subscriptions
SET paid_from = COALESCE(paid_from, started_at),
    paid_until = COALESCE(paid_until, expires_at),
    last_payment_asset = COALESCE(last_payment_asset, NULLIF(CASE WHEN amount_eth <> '' THEN 'ETH' ELSE '' END, '')),
    last_payment_amount = COALESCE(last_payment_amount, NULLIF(amount_eth, ''))
WHERE paid_from IS NULL
   OR paid_until IS NULL
   OR last_payment_asset IS NULL
   OR last_payment_amount IS NULL;

UPDATE subscriptions
SET status = CASE
  WHEN paid_until IS NULL THEN 'active'
  WHEN paid_until <= NOW() THEN 'expired'
  WHEN paid_until <= NOW() + INTERVAL '5 days' THEN 'expiring'
  ELSE 'active'
END;

CREATE INDEX IF NOT EXISTS subscriptions_paid_until_idx
  ON subscriptions (paid_until);
CREATE INDEX IF NOT EXISTS subscriptions_telegram_chat_idx
  ON subscriptions (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

ALTER TABLE plan_payment_events
  DROP CONSTRAINT IF EXISTS plan_payment_events_amount_wei_check;
ALTER TABLE plan_payment_events
  ALTER COLUMN amount_wei DROP NOT NULL,
  ALTER COLUMN amount_eth DROP NOT NULL;

ALTER TABLE plan_payment_events
  ADD COLUMN IF NOT EXISTS billing_period VARCHAR(16),
  ADD COLUMN IF NOT EXISTS asset_symbol VARCHAR(16),
  ADD COLUMN IF NOT EXISTS asset_contract VARCHAR(42),
  ADD COLUMN IF NOT EXISTS amount_atomic NUMERIC(78, 0),
  ADD COLUMN IF NOT EXISTS amount_display VARCHAR(64),
  ADD COLUMN IF NOT EXISTS paid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_days INTEGER;

UPDATE plan_payment_events
SET billing_period = COALESCE(billing_period, CASE WHEN payment_kind = 'one_off' THEN 'one_off' ELSE 'monthly' END),
    asset_symbol = COALESCE(asset_symbol, 'ETH'),
    amount_atomic = COALESCE(amount_atomic, amount_wei),
    amount_display = COALESCE(amount_display, amount_eth),
    paid_from = COALESCE(paid_from, confirmed_at),
    subscription_days = COALESCE(subscription_days, CASE WHEN payment_kind = 'subscription' THEN 30 ELSE NULL END)
WHERE billing_period IS NULL
   OR asset_symbol IS NULL
   OR amount_atomic IS NULL
   OR amount_display IS NULL
   OR paid_from IS NULL
   OR (payment_kind = 'subscription' AND subscription_days IS NULL);

ALTER TABLE plan_payment_events
  DROP CONSTRAINT IF EXISTS plan_payment_events_billing_period_check;
ALTER TABLE plan_payment_events
  ADD CONSTRAINT plan_payment_events_billing_period_check
  CHECK (billing_period IN ('one_off', 'monthly', 'upfront'));

CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code VARCHAR(64) PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegram_link_codes_wallet_idx
  ON telegram_link_codes (wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS telegram_link_codes_expiry_idx
  ON telegram_link_codes (expires_at)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS subscription_reminder_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  paid_until TIMESTAMPTZ NOT NULL,
  reminder_kind VARCHAR(16) NOT NULL
    CHECK (reminder_kind IN ('five_days', 'two_days', 'expiry')),
  telegram_chat_id BIGINT,
  status VARCHAR(16) NOT NULL
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  telegram_message_id BIGINT,
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  CONSTRAINT subscription_reminder_once UNIQUE (wallet_address, paid_until, reminder_kind)
);

CREATE INDEX IF NOT EXISTS subscription_reminder_events_attempted_idx
  ON subscription_reminder_events (attempted_at DESC);

CREATE TABLE IF NOT EXISTS subscription_lifecycle_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(16) NOT NULL
    CHECK (status IN ('running', 'completed', 'failed')),
  subscriptions_checked INTEGER NOT NULL DEFAULT 0,
  statuses_updated INTEGER NOT NULL DEFAULT 0,
  reminders_due INTEGER NOT NULL DEFAULT 0,
  reminders_sent INTEGER NOT NULL DEFAULT 0,
  reminders_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS subscription_lifecycle_runs_started_idx
  ON subscription_lifecycle_runs (started_at DESC);

COMMIT;

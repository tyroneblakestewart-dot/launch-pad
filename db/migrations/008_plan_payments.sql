-- Immutable on-chain payment events plus Pro Bundle support for the existing
-- one-row-per-wallet subscriptions table. The transaction hash is the replay
-- boundary: one confirmed chain transaction can unlock exactly one purchase.
BEGIN;

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_tier_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN ('bond', 'bond_site', 'bond_pro_site', 'pro', 'pro_bundle'));

CREATE TABLE IF NOT EXISTS plan_payment_events (
  payment_tx_hash VARCHAR(128) PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  plan_id VARCHAR(32) NOT NULL
    CHECK (plan_id IN ('bond-pro-site', 'pro', 'pro-bundle')),
  tier VARCHAR(24) NOT NULL
    CHECK (tier IN ('bond_pro_site', 'pro', 'pro_bundle')),
  payment_kind VARCHAR(16) NOT NULL
    CHECK (payment_kind IN ('one_off', 'subscription')),
  amount_wei NUMERIC(78, 0) NOT NULL CHECK (amount_wei > 0),
  amount_eth VARCHAR(64) NOT NULL,
  amount_usd_cents INTEGER NOT NULL CHECK (amount_usd_cents > 0),
  chain_id BIGINT NOT NULL CHECK (chain_id > 0),
  block_number NUMERIC(78, 0) NOT NULL CHECK (block_number >= 0),
  paid_until TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS plan_payment_events_confirmed_at_idx
  ON plan_payment_events (confirmed_at DESC);
CREATE INDEX IF NOT EXISTS plan_payment_events_wallet_idx
  ON plan_payment_events (wallet_address, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS plan_payment_events_plan_idx
  ON plan_payment_events (plan_id, confirmed_at DESC);

COMMIT;

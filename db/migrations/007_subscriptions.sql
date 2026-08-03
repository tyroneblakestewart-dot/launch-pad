-- Durable paywall/subscription state backing the admin "Subscribers" section.
-- One row per wallet's current subscription; renewals and upgrades update
-- the same row rather than accumulating history. A wallet with no row here
-- is a free-tier user, not an error — the admin Subscribers view treats a
-- missing row and an empty table the same way (see lib/server/subscribers.ts).
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  tier VARCHAR(24) NOT NULL
    CHECK (tier IN ('bond', 'bond_site', 'bond_pro_site', 'pro')),
  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired')),
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  payment_tx_hash VARCHAR(128) NOT NULL DEFAULT '',
  amount_eth VARCHAR(64) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscriptions_wallet_unique UNIQUE (wallet_address)
);

CREATE INDEX IF NOT EXISTS subscriptions_expires_at_idx
  ON subscriptions (expires_at);
CREATE INDEX IF NOT EXISTS subscriptions_tier_status_idx
  ON subscriptions (tier, status);

COMMIT;

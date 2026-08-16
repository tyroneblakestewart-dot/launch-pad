-- Durable demand signal for the coming-soon Street Team add-on (issue #343).
-- No payment is taken and no entitlement is granted here — this table only
-- proves someone asked, so it must not use browser storage.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS street_team_interest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42),
  current_plan VARCHAR(24) NOT NULL DEFAULT 'free'
    CHECK (current_plan IN ('free', 'bond', 'bond_site', 'bond_pro_site', 'pro', 'pro_bundle')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent per connected wallet: registering twice from the same wallet
-- updates the one existing row instead of creating a duplicate. Anonymous
-- (NULL wallet_address) submissions are exempt — there is nothing to
-- dedupe an anonymous visitor against.
CREATE UNIQUE INDEX IF NOT EXISTS street_team_interest_wallet_idx
  ON street_team_interest (wallet_address) WHERE wallet_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS street_team_interest_created_at_idx
  ON street_team_interest (created_at DESC);

COMMIT;

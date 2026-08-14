-- Durable, short-lived wallet challenges for the paid bespoke AI site route.
-- The row is authentication state only: no signature, artwork or generated
-- content is stored, and used/expired rows are pruned by challenge creation.
BEGIN;

CREATE TABLE IF NOT EXISTS bespoke_site_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce_hash CHAR(64) NOT NULL UNIQUE,
  wallet_address VARCHAR(42) NOT NULL,
  origin VARCHAR(255) NOT NULL,
  project_hash CHAR(66) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bespoke_site_challenges_expiry_after_issue
    CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS bespoke_site_challenges_expiry_idx
  ON bespoke_site_challenges (expires_at);

CREATE INDEX IF NOT EXISTS bespoke_site_challenges_wallet_idx
  ON bespoke_site_challenges (wallet_address, issued_at DESC);

COMMIT;

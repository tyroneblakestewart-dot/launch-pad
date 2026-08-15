-- Admin-managed wallet allowlist for testing paid features without recording
-- or fabricating a payment. Revocation is timestamped; rows are never deleted.
BEGIN;

CREATE TABLE IF NOT EXISTS test_access_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  label VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT test_access_wallets_wallet_lowercase
    CHECK (wallet_address = LOWER(wallet_address)),
  CONSTRAINT test_access_wallets_wallet_format
    CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT test_access_wallets_label_length
    CHECK (CHAR_LENGTH(BTRIM(label)) BETWEEN 1 AND 120),
  CONSTRAINT test_access_wallets_revoked_after_created
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT test_access_wallets_wallet_unique
    UNIQUE (wallet_address)
);

CREATE INDEX IF NOT EXISTS test_access_wallets_active_idx
  ON test_access_wallets (wallet_address)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS test_access_wallets_created_idx
  ON test_access_wallets (created_at DESC);

COMMIT;

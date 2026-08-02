-- Durable admin authentication for serverless deployments. Only nonce and
-- session token hashes are stored; raw wallet nonces, signatures, passwords,
-- and cookie tokens never enter Postgres.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admin_login_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce_hash CHAR(64) NOT NULL UNIQUE,
  wallet_address VARCHAR(42) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_login_challenges_expiry_after_issue
    CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS admin_login_challenges_expiry_idx
  ON admin_login_challenges (expires_at);
CREATE INDEX IF NOT EXISTS admin_login_challenges_wallet_idx
  ON admin_login_challenges (wallet_address);

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_token_hash CHAR(64) PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx
  ON admin_sessions (expires_at);

COMMIT;

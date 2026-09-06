-- Google sign-in, phase 1 (owner direction, 6 Sep 2026: Google in, GitHub
-- out, X left as "coming next"; email is the useful by-product; no project
-- sync yet). A Google account is a LINKED CREDENTIAL, never a second
-- identity: the wallet stays the key for every paid or on-chain action, and
-- a Google account can be bound to at most one wallet (and a wallet to at most
-- one Google account) so entitlement can never fragment across the two.
--
-- Nothing here stores a Google token: the sign-in flow only ever reads the
-- Google user id, email, verified flag and display name from the userinfo
-- endpoint, then drops the access token. Sessions are a random token whose
-- SHA-256 is stored, exactly like admin_sessions (004_admin_auth.sql).
--
-- Also re-widens admin_service_controls_known_service /
-- admin_activity_log_known_service for the new 'google-sign-in' service key,
-- following 032_social_buy_bots.sql.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(320) NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  display_name VARCHAR(200) NOT NULL DEFAULT '',
  linked_wallet_address VARCHAR(42),
  wallet_linked_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One Google account per wallet.
CREATE UNIQUE INDEX IF NOT EXISTS user_accounts_linked_wallet_idx
  ON user_accounts (LOWER(linked_wallet_address))
  WHERE linked_wallet_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_sessions (
  session_token_hash CHAR(64) PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES user_accounts (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_account_idx ON user_sessions (account_id);
CREATE INDEX IF NOT EXISTS user_sessions_expiry_idx ON user_sessions (expires_at);

COMMENT ON TABLE user_accounts IS
  'Google sign-in accounts linked (at most one each way) to a wallet; the wallet stays the identity for every paid or on-chain action. No provider tokens are stored.';

ALTER TABLE admin_service_controls
  DROP CONSTRAINT IF EXISTS admin_service_controls_known_service;
ALTER TABLE admin_service_controls
  ADD CONSTRAINT admin_service_controls_known_service CHECK (
    service_key IN (
      'website-generation',
      'public-publishing',
      'market-feed',
      'telegram-publishing',
      'hoodchat',
      'token-chat',
      'outreach',
      'test-access',
      'social-studio-ai',
      'social-posting',
      'support',
      'token-launches',
      'buy-bot',
      'google-sign-in'
    )
  );

ALTER TABLE admin_activity_log
  DROP CONSTRAINT IF EXISTS admin_activity_log_known_service;
ALTER TABLE admin_activity_log
  ADD CONSTRAINT admin_activity_log_known_service CHECK (
    service_key IS NULL OR service_key IN (
      'website-generation',
      'public-publishing',
      'market-feed',
      'telegram-publishing',
      'hoodchat',
      'token-chat',
      'outreach',
      'test-access',
      'social-studio-ai',
      'social-posting',
      'support',
      'token-launches',
      'buy-bot',
      'google-sign-in'
    )
  );

INSERT INTO admin_service_controls (service_key)
VALUES ('google-sign-in')
ON CONFLICT (service_key) DO NOTHING;

COMMIT;

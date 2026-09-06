-- Social Studio approval sessions (owner direction, 6 Sep 2026: "it shouldn't
-- need a signature every approval"). One wallet signature unlocks post
-- approvals for 24 hours; the browser then holds a random token in an
-- httpOnly cookie and only the token's SHA-256 is stored here, exactly like
-- user_sessions (033) and the admin session. A session only ever authorises
-- POST /api/social/posts (approving a draft into the scheduled queue) for the
-- wallet it was signed by — never a connect/disconnect, a cancel, an on-chain
-- action or anything paid. Revoked rows stay until they expire so a
-- replayed token is refused rather than re-created. Idempotent.
BEGIN;

CREATE TABLE IF NOT EXISTS social_approval_sessions (
  session_token_hash CHAR(64) PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT social_approval_sessions_wallet_shape CHECK (
    wallet_address ~ '^0x[0-9a-f]{40}$'
  )
);

CREATE INDEX IF NOT EXISTS social_approval_sessions_wallet_idx
  ON social_approval_sessions (wallet_address, expires_at DESC);
CREATE INDEX IF NOT EXISTS social_approval_sessions_expiry_idx
  ON social_approval_sessions (expires_at);

COMMENT ON TABLE social_approval_sessions IS
  'One wallet signature unlocks Social Studio post approvals for 24h; only the session token''s SHA-256 is stored. Authorises approving posts for that wallet and nothing else.';

COMMIT;

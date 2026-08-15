-- Social Studio review-and-release posting (issue #335, "PR A" scope): durable
-- per-wallet X/Telegram connections and a server-owned approve-first
-- scheduled-post queue that survives the browser closing. Draft composing
-- still happens client-side in IndexedDB (lib/social-studio-db.ts) — a row
-- only lands here once a user has explicitly approved it for sending, which
-- is also the moment it becomes durable and browser-independent.
--
-- Full autopilot (Mode 2, unattended generate+post) is out of scope — see the
-- issue's own "Scope split if needed: PR A / PR B" note. Nothing in this
-- migration or the code that reads it ever posts without a prior explicit
-- per-post approval recorded in social_scheduled_posts.approved_by_wallet.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One connected destination account per wallet per platform. Credentials are
-- application-layer encrypted (lib/server/social-credentials-crypto.ts,
-- AES-256-GCM) before ever reaching this column — Postgres access alone is
-- not enough to recover a usable X token or Telegram binding.
CREATE TABLE IF NOT EXISTS social_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  platform VARCHAR(16) NOT NULL CHECK (platform IN ('x', 'telegram')),
  status VARCHAR(20) NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'reconnect_needed')),
  display_name VARCHAR(200) NOT NULL DEFAULT '',
  external_id VARCHAR(200) NOT NULL DEFAULT '',
  encrypted_credentials TEXT NOT NULL,
  reconnect_reason TEXT,
  failure_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS social_connections_wallet_platform_idx
  ON social_connections (LOWER(wallet_address), platform);

-- Short-lived, single-use storage for the mid-flight X 3-legged OAuth
-- request token. Must be durable (not in-memory) because the round trip
-- leaves this server process entirely (browser navigates to X and back,
-- possibly landing on a different serverless instance).
CREATE TABLE IF NOT EXISTS social_x_oauth_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  request_token VARCHAR(200) NOT NULL,
  encrypted_request_secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS social_x_oauth_requests_token_idx
  ON social_x_oauth_requests (request_token);

-- One row per approved post. Nothing is inserted here before a wallet has
-- explicitly approved it (approved_by_wallet/approved_at are set at insert
-- time, not later) — the approval IS the create, so "unapproved posts never
-- send" holds by construction: there is no unapproved state to leak from.
CREATE TABLE IF NOT EXISTS social_scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  body VARCHAR(2000) NOT NULL CHECK (octet_length(body) > 0),
  artwork_data_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'sent', 'partially_sent', 'failed', 'canceled')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  approved_by_wallet VARCHAR(42) NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_scheduled_posts_wallet_idx
  ON social_scheduled_posts (LOWER(wallet_address), created_at DESC);
CREATE INDEX IF NOT EXISTS social_scheduled_posts_due_idx
  ON social_scheduled_posts (status, scheduled_at);

-- Per-destination delivery state for one scheduled post. A post to "both"
-- gets two rows so X and Telegram retry/backoff/fail independently of each
-- other (a Telegram outage must never block or retry-storm the X send).
CREATE TABLE IF NOT EXISTS social_post_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_post_id UUID NOT NULL REFERENCES social_scheduled_posts(id) ON DELETE CASCADE,
  platform VARCHAR(16) NOT NULL CHECK (platform IN ('x', 'telegram')),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  external_post_id VARCHAR(200),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS social_post_destinations_post_platform_idx
  ON social_post_destinations (scheduled_post_id, platform);
CREATE INDEX IF NOT EXISTS social_post_destinations_due_idx
  ON social_post_destinations (status, next_attempt_at);

COMMIT;

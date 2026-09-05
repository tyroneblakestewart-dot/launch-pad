-- Social Studio Buy Bot (owner direction, 5 Sep 2026): a per-token Telegram
-- buy announcer. Each row is one token the owning wallet switched the bot on
-- for, bound to its own Telegram channel — deliberately separate from the
-- wallet's Social Studio posting connection in social_connections, per the
-- owner's "separate channel per bot" ruling — with the "only above" threshold
-- the Settings & Rules row has always drawn, and a cursor marking the last
-- curve trade already announced so the every-minute cron never posts a buy
-- twice or replays history from before the bot existed.
--
-- The channel binding is application-layer encrypted exactly like
-- social_connections.encrypted_credentials (lib/server/social-credentials-crypto.ts,
-- AES-256-GCM under SOCIAL_CREDENTIALS_ENCRYPTION_KEY) — Postgres access alone
-- is not enough to learn where a wallet's bot posts.
--
-- Numbered 032: 031_social_mascot_image_usage.sql belongs to the still-open
-- mascot-image allowance PR (#500), so this one steps past it to keep
-- migration numbers unique and ordered whichever merges first.
--
-- This migration also re-widens admin_service_controls_known_service /
-- admin_activity_log_known_service for the new 'buy-bot' service key
-- (ADMIN_SERVICE_DEFINITIONS gains it in the same PR), following exactly what
-- 029_token_launches.sql did for 'token-launches'.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS social_buy_bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  chain_id INTEGER NOT NULL,
  token_address VARCHAR(42) NOT NULL,
  curve_address VARCHAR(42) NOT NULL,
  channel_display_name VARCHAR(200) NOT NULL DEFAULT '',
  channel_external_id VARCHAR(200) NOT NULL DEFAULT '',
  encrypted_channel TEXT NOT NULL,
  threshold_wei NUMERIC(78, 0) NOT NULL CHECK (threshold_wei >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'reconnect_needed')),
  -- The last curve trade already announced (block number + log index), so the
  -- cron only ever posts trades strictly after it. Set at enable time to the
  -- newest trade that exists, never to zero.
  cursor_block_number NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (cursor_block_number >= 0),
  cursor_log_index INTEGER NOT NULL DEFAULT -1,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_error TEXT,
  last_posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One Buy Bot per token per wallet.
CREATE UNIQUE INDEX IF NOT EXISTS social_buy_bots_wallet_token_idx
  ON social_buy_bots (LOWER(wallet_address), chain_id, LOWER(token_address));

-- The cron lists active bots only.
CREATE INDEX IF NOT EXISTS social_buy_bots_status_idx
  ON social_buy_bots (status, updated_at);

COMMENT ON TABLE social_buy_bots IS
  'One row per token a wallet switched the Telegram Buy Bot on for; the channel binding is application-layer encrypted.';

-- Widen the admin service-key CHECK constraints (last widened by
-- 029_token_launches.sql) so the new 'buy-bot' service key can be isolated
-- and logged against.
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
      'buy-bot'
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
      'buy-bot'
    )
  );

INSERT INTO admin_service_controls (service_key)
VALUES ('buy-bot')
ON CONFLICT (service_key) DO NOTHING;

COMMIT;

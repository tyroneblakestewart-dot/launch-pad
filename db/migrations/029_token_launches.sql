-- Milestone A (issue #409), Part 2: a server-side record of on-chain token
-- launches, written at launch time via a wallet-signed API call
-- (POST /api/token-launches) and only ever inserted after the server has
-- independently read the claimed curve/token contracts on-chain and
-- confirmed they match (lib/server/token-launch-reconciliation.ts) — a row
-- can never exist for a launch that didn't really happen. This is the
-- planned future source of truth for the homepage HOODLUMS TOKENS grid
-- (currently still published_sites-backed); wiring the grid itself to read
-- from this table is left to a follow-up PR (see the issue's own suggested
-- PR A/PR B split), same as this migration's own review/apply discipline
-- for a first write-endpoint PR (mirrors 001_public_publishing.sql).
--
-- graduated/graduated_at are opportunistically refreshed by the read API
-- (GET /api/token-launches) from a live on-chain read of the curve the first
-- time it observes a launch has graduated, rather than by a dedicated sync
-- job — the curve contract itself, not this table, is the source of truth
-- for live trading/graduation state; PR B's grid should still read live
-- curve state directly for anything more current than "has it graduated".
--
-- Also widens admin_service_controls_known_service /
-- admin_activity_log_known_service (last widened by 025_support_tickets.sql)
-- to allow the new 'token-launches' service key, following exactly what
-- 025_support_tickets.sql did for 'support'.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS token_launches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id BIGINT NOT NULL CHECK (chain_id > 0),
  token_address VARCHAR(42) NOT NULL,
  curve_address VARCHAR(42) NOT NULL,
  creator_wallet_address VARCHAR(42) NOT NULL,
  token_name VARCHAR(80) NOT NULL,
  ticker VARCHAR(12) NOT NULL,
  decimals SMALLINT NOT NULL CHECK (decimals BETWEEN 0 AND 18),
  whole_token_supply VARCHAR(80) NOT NULL,
  graduation_target_wei VARCHAR(80) NOT NULL,
  graduated BOOLEAN NOT NULL DEFAULT FALSE,
  graduated_at TIMESTAMPTZ,
  launched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT token_launches_chain_token_unique UNIQUE (chain_id, token_address)
);

CREATE INDEX IF NOT EXISTS token_launches_launched_at_idx
  ON token_launches (launched_at DESC);
CREATE INDEX IF NOT EXISTS token_launches_creator_idx
  ON token_launches (LOWER(creator_wallet_address));
CREATE INDEX IF NOT EXISTS token_launches_graduated_idx
  ON token_launches (graduated);

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
      'token-launches'
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
      'token-launches'
    )
  );

INSERT INTO admin_service_controls (service_key)
VALUES ('token-launches')
ON CONFLICT (service_key) DO NOTHING;

COMMIT;

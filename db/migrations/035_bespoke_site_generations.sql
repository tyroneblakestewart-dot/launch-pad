-- Bespoke site generations (owner decisions, 6 Sep 2026): a bespoke website is
-- a one-off Bond + Pro Site purchase and nothing else — Pro / Pro Bundle are
-- Social Studio subscriptions and grant no website — and each purchase buys
-- THREE generations. After three, the buyer keeps one of the three designs
-- the studio saved, or pays again for three more. This table is the count:
-- one row per delivered bespoke page (a page the route actually streamed as
-- complete), keyed by wallet; the allowance is 3 × the wallet's recorded
-- bond-pro-site payments in plan_payment_events. Nothing here stores the
-- page itself. wallet_address is stored lower-cased by the application.
-- Idempotent.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS bespoke_site_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  project_hash VARCHAR(66) NOT NULL,
  model VARCHAR(64) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bespoke_site_generations_wallet_shape CHECK (
    wallet_address ~ '^0x[0-9a-f]{40}$'
  )
);

CREATE INDEX IF NOT EXISTS bespoke_site_generations_wallet_idx
  ON bespoke_site_generations (wallet_address, created_at DESC);

COMMENT ON TABLE bespoke_site_generations IS
  'One row per delivered bespoke AI page. Allowance = 3 generations per recorded Bond + Pro Site purchase, per wallet.';

COMMIT;

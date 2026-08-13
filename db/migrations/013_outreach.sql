-- Dormant-by-design X outreach bot for graduating pump.fun tokens
-- (issue #298): a durable approve-first queue of congratulatory drafts.
-- Nothing here posts on its own — see lib/server/outreach-cron.ts (gated by
-- OUTREACH_QUEUE_ENABLED) and lib/server/outreach-x-client.ts (gated on all
-- four X_OUTREACH_* credentials being present).
--
-- Dedupe-forever is enforced at the database level, not in application code,
-- so it holds even under concurrent cron runs: a mint can get at most one
-- 'first' row and at most one 'followup' row, ever (dismissed rows still
-- count — the partial unique indexes below have no status filter), and a
-- creator X handle that has ever received a first-touch draft can never be
-- used for a new first-touch draft again. Follow-ups for a mint the creator
-- already opted a handle into are still allowed once, since that handle
-- already had its one first-touch pass.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS outreach_queue_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  touch VARCHAR(8) NOT NULL CHECK (touch IN ('first', 'followup')),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'dismissed', 'failed')),
  token_mint VARCHAR(64) NOT NULL,
  token_name VARCHAR(200) NOT NULL,
  token_ticker VARCHAR(32) NOT NULL,
  token_artwork_url TEXT NOT NULL DEFAULT '',
  token_url TEXT NOT NULL DEFAULT '',
  progress_percent NUMERIC NOT NULL,
  creator_x_handle VARCHAR(64),
  template_key VARCHAR(64) NOT NULL,
  body VARCHAR(600) NOT NULL CHECK (octet_length(body) > 0),
  error_message TEXT,
  x_post_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ
);

-- One first-touch row per mint, ever.
CREATE UNIQUE INDEX IF NOT EXISTS outreach_queue_items_mint_first_idx
  ON outreach_queue_items (token_mint) WHERE touch = 'first';
-- One follow-up row per mint, ever.
CREATE UNIQUE INDEX IF NOT EXISTS outreach_queue_items_mint_followup_idx
  ON outreach_queue_items (token_mint) WHERE touch = 'followup';
-- One first-touch row per creator handle (case-insensitive), ever — scoped
-- to touch = 'first' only, so a mint's follow-up never collides with the
-- first-touch pass its own creator handle already used.
CREATE UNIQUE INDEX IF NOT EXISTS outreach_queue_items_handle_first_idx
  ON outreach_queue_items (LOWER(creator_x_handle)) WHERE touch = 'first' AND creator_x_handle IS NOT NULL;

CREATE INDEX IF NOT EXISTS outreach_queue_items_status_created_at_idx
  ON outreach_queue_items (status, created_at);
CREATE INDEX IF NOT EXISTS outreach_queue_items_created_at_idx
  ON outreach_queue_items (created_at);

COMMIT;

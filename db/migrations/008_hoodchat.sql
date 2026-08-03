-- Community-wide Hoodchat feed (issue #237): one flat table of short,
-- category-tagged messages, oldest first (the feed renders newest at the
-- bottom). Reports are a simple counter with an automatic hide threshold
-- rather than a moderation queue table — hidden rows stay in place for
-- admin review instead of being deleted.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS hoodchat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  category VARCHAR(16) NOT NULL
    CHECK (category IN ('new-launches', 'trading', 'projects', 'general')),
  body VARCHAR(280) NOT NULL CHECK (octet_length(body) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  hidden BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS hoodchat_messages_created_at_idx
  ON hoodchat_messages (created_at);
CREATE INDEX IF NOT EXISTS hoodchat_messages_category_created_at_idx
  ON hoodchat_messages (category, created_at);
CREATE INDEX IF NOT EXISTS hoodchat_messages_wallet_created_at_idx
  ON hoodchat_messages (wallet_address, created_at);

COMMIT;

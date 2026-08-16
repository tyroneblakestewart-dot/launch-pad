-- X posting cost control (issue #342): X's pay-per-use pricing charges far
-- more for a post containing a link than a plain one, so the posting cron
-- (lib/server/social-posting-cron.ts) must never send a link-bearing body
-- through the X API. This migration adds the storage those guarantees need:
--
-- 1. A new 'needs_composer' destination/post status: set instead of
--    attempting an X send whenever the body contains a link (detected by
--    lib/server/social-link-detection.ts). It is terminal from the cron's
--    point of view (it stops being 'pending', so listDueDestinations never
--    retries it as an API send again) but distinct from 'failed' — nothing
--    went wrong, the user just needs to tap through the free X composer
--    intent link themselves. The reason is stored in the existing
--    error_message column and surfaced by GET /api/social/posts.
-- 2. social_x_send_costs: one row per successful X API send recording its
--    estimated cost, so lib/server/social-x-cost-store.ts can aggregate a
--    per-wallet monthly total and the posting cron can refuse to spend past
--    an owner-configured monthly cap (SOCIAL_X_MONTHLY_COST_CAP_USD).
BEGIN;

ALTER TABLE social_post_destinations
  DROP CONSTRAINT IF EXISTS social_post_destinations_status_check;
ALTER TABLE social_post_destinations
  ADD CONSTRAINT social_post_destinations_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'needs_composer'));

ALTER TABLE social_scheduled_posts
  DROP CONSTRAINT IF EXISTS social_scheduled_posts_status_check;
ALTER TABLE social_scheduled_posts
  ADD CONSTRAINT social_scheduled_posts_status_check
  CHECK (status IN ('scheduled', 'sent', 'partially_sent', 'needs_composer', 'failed', 'canceled'));

-- Cost is stored in US dollars (not cents) with enough precision for a
-- fractional per-post cost like $0.015 — see
-- lib/server/social-x-cost-store.ts's DEFAULT_X_API_SEND_COST_USD.
CREATE TABLE IF NOT EXISTS social_x_send_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  destination_id UUID NOT NULL REFERENCES social_post_destinations(id) ON DELETE CASCADE,
  cost_usd NUMERIC(10, 5) NOT NULL CHECK (cost_usd >= 0),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_x_send_costs_wallet_sent_at_idx
  ON social_x_send_costs (LOWER(wallet_address), sent_at);

COMMIT;

-- Apply deliberately after owner review, same as 001. This adds one
-- nullable column; nothing writes to it yet (see issue #173) — a future,
-- separately reviewed change wires it up from bonding-curve graduation.
BEGIN;

ALTER TABLE published_sites
  ADD COLUMN IF NOT EXISTS lp_locked_at TIMESTAMPTZ NULL DEFAULT NULL;

COMMIT;

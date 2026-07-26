-- Apply deliberately after owner review; existing public rows remain live while new publishes start as drafts.
BEGIN;

ALTER TABLE published_sites
  ADD COLUMN IF NOT EXISTS visibility TEXT;

ALTER TABLE published_sites
  ADD COLUMN IF NOT EXISTS draft_token TEXT;

UPDATE published_sites
   SET visibility = 'live'
 WHERE visibility IS NULL;

ALTER TABLE published_sites
  ALTER COLUMN visibility SET DEFAULT 'draft';

ALTER TABLE published_sites
  ALTER COLUMN visibility SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'published_sites_visibility_check'
  ) THEN
    ALTER TABLE published_sites
      ADD CONSTRAINT published_sites_visibility_check
      CHECK (visibility IN ('draft', 'live'));
  END IF;
END;
$$;

COMMIT;

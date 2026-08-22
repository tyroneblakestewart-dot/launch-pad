-- Server-side Pro / Pro Bundle project-slot registry. Pro owns one active
-- token-project slot; Pro Bundle owns up to three. Existing subscribers are
-- grandfathered naturally: their first entitled request registers its
-- client-generated project id, so no backfill is required.
--
-- project_id is a billing guardrail identifier supplied by the browser. It
-- is deliberately not treated as cryptographic proof that two requests
-- describe the same token. released_by is retained so the seven-day user
-- release cooldown can ignore owner/admin overrides.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS social_project_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  project_id VARCHAR(200) NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  released_by VARCHAR(8),
  CONSTRAINT social_project_slots_wallet_shape CHECK (
    wallet_address ~ '^0x[0-9A-Fa-f]{40}$'
  ),
  CONSTRAINT social_project_slots_project_id_shape CHECK (
    project_id = BTRIM(project_id)
    AND octet_length(project_id) BETWEEN 1 AND 200
  ),
  CONSTRAINT social_project_slots_display_name_shape CHECK (
    display_name = BTRIM(display_name)
    AND octet_length(display_name) BETWEEN 1 AND 200
  ),
  CONSTRAINT social_project_slots_release_shape CHECK (
    (released_at IS NULL AND released_by IS NULL)
    OR
    (released_at IS NOT NULL AND released_by IN ('user', 'admin'))
  )
);

-- One active registration for a particular browser project id and wallet.
-- A released project can be registered again later as a new historical row.
CREATE UNIQUE INDEX IF NOT EXISTS social_project_slots_active_project_key
  ON social_project_slots (LOWER(wallet_address), project_id)
  WHERE released_at IS NULL;

-- Active-slot listing/counting for entitlement checks and admin account views.
CREATE INDEX IF NOT EXISTS social_project_slots_active_wallet_idx
  ON social_project_slots (LOWER(wallet_address), registered_at)
  WHERE released_at IS NULL;

-- The most recent user release is the durable seven-day cooldown boundary.
-- Admin releases intentionally do not start or extend that user cooldown.
CREATE INDEX IF NOT EXISTS social_project_slots_user_release_idx
  ON social_project_slots (LOWER(wallet_address), released_at DESC)
  WHERE released_by = 'user';

COMMIT;

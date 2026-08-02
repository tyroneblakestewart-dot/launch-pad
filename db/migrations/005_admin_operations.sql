-- Durable operational controls for the private admin dashboard. Isolation is
-- deliberately limited to server-backed feature groups; admin authentication,
-- Postgres itself and deployment health cannot be disabled from this table.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admin_service_controls (
  service_key VARCHAR(64) PRIMARY KEY,
  isolated BOOLEAN NOT NULL DEFAULT FALSE,
  reason VARCHAR(500) NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_service_controls_known_service CHECK (
    service_key IN (
      'website-generation',
      'public-publishing',
      'market-feed',
      'telegram-publishing'
    )
  )
);

INSERT INTO admin_service_controls (service_key)
VALUES
  ('website-generation'),
  ('public-publishing'),
  ('market-feed'),
  ('telegram-publishing')
ON CONFLICT (service_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_kind VARCHAR(64) NOT NULL,
  service_key VARCHAR(64),
  message VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_activity_log_known_service CHECK (
    service_key IS NULL OR service_key IN (
      'website-generation',
      'public-publishing',
      'market-feed',
      'telegram-publishing'
    )
  )
);

CREATE INDEX IF NOT EXISTS admin_activity_log_created_at_idx
  ON admin_activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_log_service_idx
  ON admin_activity_log (service_key, created_at DESC);

COMMIT;

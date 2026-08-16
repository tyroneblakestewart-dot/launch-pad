-- Client-side crash reporting (issue #353). Browser crashes were previously
-- invisible to the owner (server logs only cover the backend) — testers
-- would just report "it didn't work". Stores individual occurrences, indexed
-- for grouping by (message, route_path) in /admin's Errors section.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS client_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  stack TEXT,
  route_path TEXT NOT NULL,
  wallet_address VARCHAR(42),
  user_agent TEXT,
  viewport_width INTEGER,
  build_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS client_errors_group_idx
  ON client_errors (message, route_path, created_at DESC);

CREATE INDEX IF NOT EXISTS client_errors_created_at_idx
  ON client_errors (created_at DESC);

-- One row per resolved (message, route_path) group. Resolving is not
-- permanent: if a fresh occurrence lands after resolved_at, the group's
-- last_seen moves past resolved_at and it reappears in the admin view
-- automatically — a recurring bug can't stay silently hidden forever.
CREATE TABLE IF NOT EXISTS client_error_resolutions (
  message TEXT NOT NULL,
  route_path TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message, route_path)
);

COMMIT;

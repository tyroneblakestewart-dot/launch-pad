-- Operations cost/margin cockpit (issue #368). Two durable tables:
--   ai_operation_costs   — one immutable row per measurable paid AI provider
--                          attempt (not per outer HTTP request), so retries
--                          and application-rejected responses each meter
--                          separately.
--   fixed_operating_costs — owner-entered recurring costs (hosting, tooling,
--                          etc.), monthly or annual cadence.
-- social_x_send_costs (019_social_x_cost_control.sql) remains the X source of
-- truth; this migration never duplicates X rows into ai_operation_costs —
-- Operations queries union/aggregate the two tables instead.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ai_operation_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  feature_key VARCHAR(64) NOT NULL,
  wallet_address VARCHAR(42),
  access_source VARCHAR(16) NOT NULL CHECK (access_source IN ('paid', 'test-allowlist', 'free', 'unknown')),
  provider VARCHAR(24) NOT NULL CHECK (provider IN ('openai', 'vercel-ai-gateway')),
  model VARCHAR(64) NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  web_search_call_count INTEGER NOT NULL DEFAULT 0 CHECK (web_search_call_count >= 0),
  -- Numeric(14,8): a single small call (a few hundred tokens) must never
  -- round to zero the way a cents-scale column would.
  estimated_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  -- Snapshots of every unit price used for this row, so historical rows stay
  -- explainable even after the configured env prices change later.
  input_cost_usd_per_million NUMERIC(14, 8) NOT NULL DEFAULT 0 CHECK (input_cost_usd_per_million >= 0),
  cached_input_cost_usd_per_million NUMERIC(14, 8) NOT NULL DEFAULT 0 CHECK (cached_input_cost_usd_per_million >= 0),
  output_cost_usd_per_million NUMERIC(14, 8) NOT NULL DEFAULT 0 CHECK (output_cost_usd_per_million >= 0),
  web_search_cost_usd_per_call NUMERIC(14, 8) NOT NULL DEFAULT 0 CHECK (web_search_cost_usd_per_call >= 0),
  image_cost_usd_per_image NUMERIC(14, 8) NOT NULL DEFAULT 0 CHECK (image_cost_usd_per_image >= 0),
  CHECK (wallet_address IS NULL OR wallet_address ~ '^0x[0-9a-fA-F]{40}$')
);

CREATE INDEX IF NOT EXISTS ai_operation_costs_occurred_at_idx
  ON ai_operation_costs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_operation_costs_feature_occurred_idx
  ON ai_operation_costs (feature_key, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_operation_costs_wallet_occurred_idx
  ON ai_operation_costs (LOWER(wallet_address), occurred_at DESC)
  WHERE wallet_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS fixed_operating_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (LENGTH(TRIM(name)) > 0),
  amount_usd NUMERIC(12, 2) NOT NULL CHECK (amount_usd > 0),
  cadence VARCHAR(8) NOT NULL CHECK (cadence IN ('monthly', 'annual')),
  note TEXT CHECK (note IS NULL OR LENGTH(TRIM(note)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fixed_operating_costs_created_at_idx
  ON fixed_operating_costs (created_at DESC);

COMMIT;

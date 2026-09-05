-- Daily mascot-image allowance (owner decision, 5 Sep 2026): two AI images per
-- token per UTC day, hard-blocked at the cap until midnight. ai_operation_costs
-- records images per wallet with no project id, and the allowance is per token
-- (a Pro Bundle wallet gets the allowance on each of its tokens), so the count
-- lives in its own small table keyed by wallet + browser project id + day.
-- wallet_address is stored lower-cased by the application. Idempotent.
BEGIN;

CREATE TABLE IF NOT EXISTS social_mascot_image_usage (
  wallet_address VARCHAR(42) NOT NULL,
  project_id VARCHAR(200) NOT NULL,
  used_on DATE NOT NULL,
  image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wallet_address, project_id, used_on),
  CONSTRAINT social_mascot_image_usage_wallet_shape CHECK (
    wallet_address ~ '^0x[0-9a-f]{40}$'
  ),
  CONSTRAINT social_mascot_image_usage_project_id_shape CHECK (
    project_id = BTRIM(project_id)
    AND octet_length(project_id) BETWEEN 1 AND 200
  )
);

COMMIT;

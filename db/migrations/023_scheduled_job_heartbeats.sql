-- Durable, constant-size heartbeat for scheduled jobs. Each job owns one
-- row, so a once-per-minute cron does not create an ever-growing log table.
BEGIN;

CREATE TABLE IF NOT EXISTS scheduled_job_heartbeats (
  job_key VARCHAR(64) PRIMARY KEY,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_succeeded_at TIMESTAMPTZ,
  last_status VARCHAR(16) NOT NULL DEFAULT 'never'
    CHECK (last_status IN ('never', 'running', 'succeeded', 'failed')),
  last_processed INTEGER NOT NULL DEFAULT 0 CHECK (last_processed >= 0),
  last_sent INTEGER NOT NULL DEFAULT 0 CHECK (last_sent >= 0),
  last_retried INTEGER NOT NULL DEFAULT 0 CHECK (last_retried >= 0),
  last_failed INTEGER NOT NULL DEFAULT 0 CHECK (last_failed >= 0),
  last_routed_to_composer INTEGER NOT NULL DEFAULT 0
    CHECK (last_routed_to_composer >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE scheduled_job_heartbeats IS
  'One overwrite-only operational heartbeat per scheduled job; no post content, credentials, or error strings.';

COMMIT;

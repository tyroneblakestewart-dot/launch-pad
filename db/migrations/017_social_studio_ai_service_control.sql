-- Widens admin_service_controls_known_service and
-- admin_activity_log_known_service to include 'social-studio-ai'
-- (lib/admin-operations.ts ADMIN_SERVICE_DEFINITIONS, added by #334) and
-- seeds its default (not isolated) row, following exactly what
-- 016_test_access_kill_switch.sql did for 'test-access'. Without this, the
-- admin isolation toggle for 'social-studio-ai' fails at the Postgres
-- constraint and recordAdminActivityBestEffort silently drops its activity
-- log entries because 'social-studio-ai' was never an allowed service_key.
BEGIN;

ALTER TABLE admin_service_controls
  DROP CONSTRAINT IF EXISTS admin_service_controls_known_service;
ALTER TABLE admin_service_controls
  ADD CONSTRAINT admin_service_controls_known_service CHECK (
    service_key IN (
      'website-generation',
      'public-publishing',
      'market-feed',
      'telegram-publishing',
      'hoodchat',
      'token-chat',
      'outreach',
      'test-access',
      'social-studio-ai'
    )
  );

ALTER TABLE admin_activity_log
  DROP CONSTRAINT IF EXISTS admin_activity_log_known_service;
ALTER TABLE admin_activity_log
  ADD CONSTRAINT admin_activity_log_known_service CHECK (
    service_key IS NULL OR service_key IN (
      'website-generation',
      'public-publishing',
      'market-feed',
      'telegram-publishing',
      'hoodchat',
      'token-chat',
      'outreach',
      'test-access',
      'social-studio-ai'
    )
  );

INSERT INTO admin_service_controls (service_key)
VALUES ('social-studio-ai')
ON CONFLICT (service_key) DO NOTHING;

COMMIT;

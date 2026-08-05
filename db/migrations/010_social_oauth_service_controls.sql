-- Admin isolation switches for the X (Twitter) OAuth and Telegram Login
-- Widget "connect" flows added to the token studio (issue #246). No new data
-- table is needed for the feature itself: a verified handle is written into
-- the existing TokenProject xHandle/telegram fields client-side, exactly
-- like the free-text values they replace.
BEGIN;

ALTER TABLE admin_service_controls
  DROP CONSTRAINT admin_service_controls_known_service;
ALTER TABLE admin_service_controls
  ADD CONSTRAINT admin_service_controls_known_service CHECK (
    service_key IN (
      'website-generation',
      'public-publishing',
      'market-feed',
      'telegram-publishing',
      'twitter-oauth',
      'telegram-oauth'
    )
  );

ALTER TABLE admin_activity_log
  DROP CONSTRAINT admin_activity_log_known_service;
ALTER TABLE admin_activity_log
  ADD CONSTRAINT admin_activity_log_known_service CHECK (
    service_key IS NULL OR service_key IN (
      'website-generation',
      'public-publishing',
      'market-feed',
      'telegram-publishing',
      'twitter-oauth',
      'telegram-oauth'
    )
  );

INSERT INTO admin_service_controls (service_key)
VALUES
  ('twitter-oauth'),
  ('telegram-oauth')
ON CONFLICT (service_key) DO NOTHING;

COMMIT;

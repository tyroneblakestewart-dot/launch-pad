-- Wires the wallet test-access allowlist into the existing admin
-- service-isolation switch (the same mechanism hoodchat, token-chat and
-- outreach already use) so the bypass ships with a one-tap admin kill
-- switch. Widens admin_service_controls_known_service and
-- admin_activity_log_known_service, which were never extended when
-- hoodchat, token-chat and outreach were added as isolation keys, and
-- seeds a default (not isolated) row for the new 'test-access' key.
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
      'test-access'
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
      'test-access'
    )
  );

INSERT INTO admin_service_controls (service_key)
VALUES ('test-access')
ON CONFLICT (service_key) DO NOTHING;

COMMIT;

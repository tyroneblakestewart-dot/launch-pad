-- Support tickets, Phase A: the pipe (issue #393). Wallet-signed reporting,
-- an admin queue and a best-effort Telegram owner alert. Deliberately no AI
-- assistant, auto-answer, or unattended action anywhere in this schema or
-- the code that reads it — every reply is a human (user or owner) typing
-- into a box. That's Phase B, out of scope here.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One row per report. `diagnostics` is assembled server-side only at create
-- time (plan/entitlement, social connection platform+status list, recent
-- client-error count) — never client-supplied, and never contains
-- credentials, encrypted blobs, tokens, secrets or reconnect payloads.
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(42) NOT NULL,
  category VARCHAR(32) NOT NULL CHECK (
    category IN ('account', 'payments', 'site-builder', 'social-studio', 'publishing', 'other')
  ),
  subject VARCHAR(200) NOT NULL CHECK (octet_length(subject) > 0),
  body VARCHAR(4000) NOT NULL CHECK (octet_length(body) > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'needs_user', 'solved', 'closed')
  ),
  diagnostics JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_tickets_wallet_created_idx
  ON support_tickets (LOWER(wallet_address), created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx
  ON support_tickets (status);

-- Follow-up thread. A user can reply to their own open/needs_user ticket;
-- the owner replies from /admin, which also flips the ticket to
-- 'needs_user'. Never touched by cron or auto-answer code.
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author VARCHAR(8) NOT NULL CHECK (author IN ('user', 'owner')),
  body VARCHAR(4000) NOT NULL CHECK (octet_length(body) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx
  ON support_ticket_messages (ticket_id, created_at);

-- Widen the admin service-key CHECK constraints (last widened by
-- 018_social_studio_connections.sql for 'social-posting') to also allow
-- 'support', which ADMIN_SERVICE_DEFINITIONS gains in this PR for the
-- System Health pipeline and service-isolation switch. Preserves every
-- currently allowed service key.
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
      'social-studio-ai',
      'social-posting',
      'support'
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
      'social-studio-ai',
      'social-posting',
      'support'
    )
  );

INSERT INTO admin_service_controls (service_key)
VALUES ('support')
ON CONFLICT (service_key) DO NOTHING;

COMMIT;

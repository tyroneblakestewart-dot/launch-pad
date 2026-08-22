-- Anonymous/no-wallet support reporting (issue #405). wallet_address becomes
-- nullable for a ticket filed without a connected wallet; every such ticket
-- instead carries a server-generated, cryptographically random reference
-- code the reporter can use to check status later — anonymous tickets never
-- gain a reply thread, since the reporter has no wallet to authenticate
-- with. The two paths are mutually exclusive by CHECK constraint: a ticket
-- has exactly one of wallet_address or reference_code, never both, never
-- neither. Every existing category/status/body/attachment/service
-- constraint from 025_support_tickets.sql / 026_support_ticket_attachments.sql
-- is preserved untouched — this migration only alters support_tickets, it
-- never recreates it.
BEGIN;

ALTER TABLE support_tickets
  ALTER COLUMN wallet_address DROP NOT NULL;

ALTER TABLE support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_wallet_address_shape;
ALTER TABLE support_tickets
  ADD CONSTRAINT support_tickets_wallet_address_shape CHECK (
    wallet_address IS NULL OR wallet_address ~ '^0x[0-9A-Fa-f]{40}$'
  );

-- Human-quotable format "XXXX-XXXXXX" (4 + 6 chars) drawn from a 32-symbol
-- alphabet excluding visually ambiguous characters (0/O, 1/I/L) — see
-- generateSupportTicketReferenceCode in lib/server/support-tickets-store.ts.
-- Stored uppercase; lookups normalise the same way before querying.
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS reference_code VARCHAR(11);

ALTER TABLE support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_reference_code_shape;
ALTER TABLE support_tickets
  ADD CONSTRAINT support_tickets_reference_code_shape CHECK (
    reference_code IS NULL OR reference_code ~ '^[A-Z0-9]{4}-[A-Z0-9]{6}$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_reference_code_key
  ON support_tickets (reference_code)
  WHERE reference_code IS NOT NULL;

ALTER TABLE support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_wallet_xor_reference;
ALTER TABLE support_tickets
  ADD CONSTRAINT support_tickets_wallet_xor_reference CHECK (
    (wallet_address IS NOT NULL AND reference_code IS NULL) OR
    (wallet_address IS NULL AND reference_code IS NOT NULL)
  );

COMMIT;

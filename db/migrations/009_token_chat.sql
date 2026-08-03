-- Per-token Hoodchat tab (issue #237): messages scoped to one chain +
-- contract address, mirroring hoodchat_messages' moderation shape.
-- contract_address is stored as supplied (both 0x EVM and base58 Solana
-- addresses fit VARCHAR(64)) and compared case-insensitively in queries.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS token_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain VARCHAR(16) NOT NULL CHECK (chain IN ('robinhood', 'solana')),
  contract_address VARCHAR(64) NOT NULL,
  wallet_address VARCHAR(42) NOT NULL,
  body VARCHAR(280) NOT NULL CHECK (octet_length(body) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  hidden BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS token_chat_messages_token_created_at_idx
  ON token_chat_messages (chain, contract_address, created_at);
CREATE INDEX IF NOT EXISTS token_chat_messages_wallet_token_created_at_idx
  ON token_chat_messages (wallet_address, chain, contract_address, created_at);

COMMIT;

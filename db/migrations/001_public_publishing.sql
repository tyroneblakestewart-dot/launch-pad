-- Apply deliberately after owner review; never run this first public-write migration automatically in CI or previews.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS published_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(48) NOT NULL,
  token_name VARCHAR(80) NOT NULL,
  ticker VARCHAR(12) NOT NULL,
  description VARCHAR(1000) NOT NULL,
  supply VARCHAR(80) NOT NULL,
  decimals SMALLINT NOT NULL CHECK (decimals BETWEEN 0 AND 255),
  chain VARCHAR(16) NOT NULL CHECK (chain IN ('robinhood', 'solana')),
  chain_id VARCHAR(64) NOT NULL,
  contract_address VARCHAR(128) NOT NULL DEFAULT '',
  generated_html TEXT NOT NULL CHECK (octet_length(generated_html) <= 90000),
  artwork_reference TEXT NOT NULL CHECK (octet_length(artwork_reference) <= 8100000),
  owner_wallet_address VARCHAR(42) NOT NULL,
  x_handle VARCHAR(128) NOT NULL DEFAULT '',
  telegram VARCHAR(256) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('draft', 'prepared', 'launched')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT published_sites_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS published_sites_owner_wallet_idx
  ON published_sites (owner_wallet_address);

CREATE TABLE IF NOT EXISTS wallet_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce_hash CHAR(64) NOT NULL UNIQUE,
  wallet_address VARCHAR(42) NOT NULL,
  slug VARCHAR(48) NOT NULL,
  wallet_chain_id BIGINT NOT NULL CHECK (wallet_chain_id > 0),
  site_payload_hash CHAR(64) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallet_nonces_expiry_after_issue CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS wallet_nonces_expiry_idx
  ON wallet_nonces (expires_at);
CREATE INDEX IF NOT EXISTS wallet_nonces_wallet_slug_idx
  ON wallet_nonces (wallet_address, slug);

CREATE OR REPLACE FUNCTION set_published_sites_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS published_sites_set_updated_at ON published_sites;
CREATE TRIGGER published_sites_set_updated_at
BEFORE UPDATE ON published_sites
FOR EACH ROW
EXECUTE FUNCTION set_published_sites_updated_at();

COMMIT;

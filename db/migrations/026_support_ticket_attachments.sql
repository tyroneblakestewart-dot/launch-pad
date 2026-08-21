-- Optional screenshot attachment on new support tickets (issue #398). One
-- nullable column holding a size-capped data URL, following the same
-- storage approach as social_scheduled_posts.artwork_data_url
-- (018_social_studio_connections.sql) rather than a separate attachment
-- table — a single ticket ever has at most one image, and only at creation
-- (follow-up replies stay text-only). The octet_length cap here is a
-- database-level backstop; the authoritative mime-allowlist and byte-cap
-- validation happens server-side in lib/server/support-ticket-attachment.ts
-- before a row is ever written, mirroring published_sites.artwork_reference's
-- CHECK in 001_public_publishing.sql. 2,100,000 bytes comfortably covers a
-- base64 data: URL for the client compressor's ~1.5MB (MAX_COMPRESSED_ARTWORK_BYTES)
-- binary ceiling (lib/artwork-compression.ts), which base64-encodes to
-- ~2,000,024 characters worst case.
BEGIN;

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS attachment_data_url TEXT
    CHECK (attachment_data_url IS NULL OR octet_length(attachment_data_url) <= 2100000);

COMMIT;

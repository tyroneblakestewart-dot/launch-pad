-- Adds artwork storage to token_launches (issue #438): token_launches
-- carried no artwork reference at all, so every homepage grid card fell
-- back to a letter initial even for a launch whose studio project already
-- had a hero image in memory at record time. `artwork_thumbnail` is a
-- nullable, client-captured square thumbnail (WEBP with a JPEG fallback,
-- max 512x512, size-capped) validated server-side
-- (lib/server/token-launch-artwork-validation.ts) before every insert —
-- this column is never written from an unvalidated value. It is deliberately
-- outside the wallet-signed challenge payload: artwork is cosmetic,
-- non-authoritative data attached by whoever is already legitimately
-- recording the launch, not a fact the signature needs to cover.
--
-- The octet_length ceiling here is a defence-in-depth backstop with generous
-- headroom above the enforced 160,000-decoded-byte application limit
-- (~213,360 base64 characters worst case for the longest allowed
-- "data:image/webp;base64," prefix) — the application check in
-- lib/server/token-launch-artwork-validation.ts is the real gate, following
-- 001_public_publishing.sql's and 026_support_ticket_attachments.sql's own
-- CHECK(octet_length(...)) pattern.
BEGIN;

ALTER TABLE token_launches
  ADD COLUMN IF NOT EXISTS artwork_thumbnail TEXT
    CHECK (artwork_thumbnail IS NULL OR octet_length(artwork_thumbnail) <= 220000);

COMMIT;

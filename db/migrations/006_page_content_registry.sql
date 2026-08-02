-- Durable content registry backing the admin "Pages" CMS section. Every row
-- is one editable element (heading, copy, button label/link, or a section
-- visibility toggle) on one registered public page. `published_value` is
-- what live traffic reads; `draft_value` is staged and only ever shown to an
-- authenticated admin preview request. A missing row, or a row with
-- `has_published = FALSE`, means the page's hardcoded default still applies
-- --content editing must never be able to take a page down.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS page_content_entries (
  page_id VARCHAR(64) NOT NULL,
  element_id VARCHAR(128) NOT NULL,
  element_type VARCHAR(32) NOT NULL,
  draft_value TEXT NOT NULL DEFAULT '',
  has_draft BOOLEAN NOT NULL DEFAULT FALSE,
  draft_updated_at TIMESTAMPTZ,
  draft_updated_by VARCHAR(64),
  published_value TEXT NOT NULL DEFAULT '',
  has_published BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  published_by VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (page_id, element_id),
  CONSTRAINT page_content_entries_known_type CHECK (
    element_type IN ('heading', 'text', 'button_label', 'button_link', 'visibility')
  )
);

CREATE INDEX IF NOT EXISTS page_content_entries_page_idx
  ON page_content_entries (page_id);

COMMIT;

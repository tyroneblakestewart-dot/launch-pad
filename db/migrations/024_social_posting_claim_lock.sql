-- Fix duplicate Telegram/X sends from the social-posting cron (issue #377):
-- a DB write failure in post-send bookkeeping (markDestinationSent /
-- resetFailures) right after a successful publish was previously
-- misclassified as a publish failure, scheduling a duplicate send.
-- lib/server/social-posting-cron.ts now separates "did the publish
-- succeed" from "did we record it" so a bookkeeping failure can never
-- trigger a resend on its own. This migration adds the claim-before-send
-- lock that closes the other half of the bug: two overlapping cron
-- invocations (Vercel cron is at-least-once, maxDuration 60s on a
-- per-minute schedule) could otherwise both read the same due row and
-- both publish it.
--
-- listDueDestinations (lib/server/social-scheduled-posts-store.ts) now
-- atomically claims each due row it selects, flipping it
-- 'pending' -> 'sending' in the same statement via FOR UPDATE SKIP LOCKED,
-- so a second overlapping invocation can never see the same row as still
-- due. A row stuck in 'sending' for more than SENDING_CLAIM_STALE_MS
-- (5 minutes — comfortably longer than the cron's 60s maxDuration) is
-- treated as claimable again, recovering a crashed run. 'sending' is
-- destination-level only; computeRolledUpPostStatus treats it the same as
-- 'pending' so the post stays 'scheduled' (visible, not silently stuck)
-- while a send is in flight.
BEGIN;

ALTER TABLE social_post_destinations
  DROP CONSTRAINT IF EXISTS social_post_destinations_status_check;
ALTER TABLE social_post_destinations
  ADD CONSTRAINT social_post_destinations_status_check
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'needs_composer'));

COMMIT;

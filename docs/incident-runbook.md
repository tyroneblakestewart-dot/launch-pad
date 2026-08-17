# Hoodlums incident runbook

Use this page on a phone when Hoodlums is behaving abnormally. Production is `https://hoodlums.dev`. The Vercel team is **tyrone-launchpad** and the Vercel project is **launch-pad-o2gl**. The Supabase project is **tyroneblakestewart-dot's Project**, project reference **piyodmgvsuziaabteyru**, in **eu-central-1**.

## Look here first

Open `https://hoodlums.dev/api/health` in Safari. `{"status":"up"}` with HTTP 200 means the Vercel function and Postgres both answered. `{"status":"down"}` or any non-200 response means the database-aware health check failed or the public probe was rate-limited. It intentionally reveals no reason.

Next open Vercel, tap **tyrone-launchpad**, tap **launch-pad-o2gl**, tap **Logs**, select **Production**, and search around the first failure time. Do not paste secrets from the logs into a public issue.

Then open `https://hoodlums.dev/admin`, sign in, tap **System Health**, and open the red or amber service. This dashboard depends on Postgres, so it may be unavailable during a database outage. That is why `/api/health` and Vercel logs come first.

## Immediate database-outage response

The August 2026 incidents showed two important patterns. During the password-rotation incident, normal pages still rendered while token lists were empty, admin login failed, `/api/admin/operations` returned 500, and database-backed APIs failed. During the connection incident, logs showed `(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15`; `/api/admin/operations` returned 500, `/api/subscriptions/status` returned 503, and the homepage `listLive` query failed while pages still returned 200.

When those symptoms appear:

1. Open `/api/health`. Treat any non-200 as a real outage even when the homepage itself renders.
2. Open Vercel Production logs and search for `password authentication failed`, `EMAXCONNSESSION`, `max clients reached`, `connection refused`, `timeout`, and the failing route.
3. In Vercel, tap **Settings**, tap **Environment Variables**, search `DATABASE_URL`, and confirm Production uses the Supabase **Transaction pooler** string on port **6543**. Never reveal or copy the password into chat.
4. Search `DATABASE_POOL_MAX`. Leave it unset or set it to `1`. Empty, invalid, zero, and negative values safely fall back to one. Do not raise it during an incident: every warm serverless instance owns its own pool, so a larger value multiplies total database sessions.
5. If `DATABASE_URL` was changed, open **Deployments**, open the latest Production deployment, tap the three-dot menu, tap **Redeploy**, and wait for it to finish.
6. Recheck `/api/health`, then `/admin` System Health, `/api/subscriptions/status` through the product UI, and the homepage token list.
7. Do not keep retrying migrations or repeatedly redeploying while the database is saturated. Each attempt can create more connections.

The DB-backed service-isolation switches are themselves stored in Postgres. The general isolation helper currently fails open if that table cannot be read. During a full database outage you may also be unable to sign into `/admin`. For an external-send emergency, use the relevant Vercel environment gate below until the database and admin controls recover.

## Database connection contract

**Application runtime:** Vercel must use Supabase's Shared **Transaction pooler**, port **6543**. The application pool defaults to one client per warm instance and releases an idle client after five seconds.

**Migrations and maintenance:** run `npm run db:migrate` with the Supabase Shared **Session pooler**, port **5432**, supplied as `DATABASE_URL` only in the terminal session running the migration. Do not run migrations against the runtime Transaction-pooler string.

The exact pooler hostname is not stored in this repository and must not be guessed. In Supabase, open **tyroneblakestewart-dot's Project**, tap **Connect**, choose the required pooler mode, and copy the displayed string. Check that the runtime copy ends in `:6543/postgres` and the migration copy ends in `:5432/postgres` before saving either one.

Do not point Vercel at `db.piyodmgvsuziaabteyru.supabase.co`. That direct host is generally IPv6-only unless a compatible paid IPv4 option has been deliberately enabled and verified; Vercel must use the pooler.

## Rotate database credentials honestly

A genuine no-downtime rotation needs overlapping credentials. The safest method is a separate, least-privileged application database role rather than sharing the main `postgres` password.

1. In Supabase, create a new restricted application role and password with only the permissions Hoodlums needs. Keep the existing role active.
2. Open **Connect**, copy the new role's Transaction-pooler string on port 6543, and test it without replacing Production.
3. In Vercel **launch-pad-o2gl**, open **Settings → Environment Variables → DATABASE_URL**, replace only the Production value, and save.
4. Redeploy Production.
5. Confirm `/api/health` returns HTTP 200 and `{"status":"up"}`. Sign into `/admin`, open System Health, and confirm the database and affected features are green.
6. Only after the new credential is verified should the old application credential be revoked.
7. Keep a separate Session-pooler string on port 5432 for migrations and maintenance.

If the only credential is the single `postgres` password, resetting it invalidates Vercel's old value immediately. There will be an honest short failure window between the reset and the successful Vercel redeployment. Prepare the new value and the Vercel screen first, update and redeploy immediately, and verify `/api/health`; do **not** describe this single-password method as zero downtime.

## Backups and Point-in-Time Recovery

To confirm daily backups, open Supabase, tap **tyroneblakestewart-dot's Project**, tap **Database**, tap **Backups**, then tap **Scheduled backups**. Confirm a recent daily backup is listed. Do not press **Restore** merely to test it; a restore is an incident operation and causes service interruption.

Point-in-Time Recovery is not a free checkbox. As of August 2026, seven-day PITR is roughly **$100 per month** and also requires at least the eligible **Small compute add-on**, on top of the underlying paid project. Longer retention costs more. Before enabling it, open **Database → Backups → Point in Time**, read the exact current price shown by Supabase, and confirm the compute prerequisite. Daily backups should be confirmed now; PITR should only be enabled after accepting the real monthly cost. Official references: `https://supabase.com/docs/guides/platform/backups` and `https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery`.

## Phone controls in `/admin`

Open `https://hoodlums.dev/admin`, sign in, tap **Issues**, and find **Service isolation**. To pause a service, tap **Isolate service**, enter a reason of at least five characters, then tap **Confirm isolation**. To resume it, tap **Restore service** and confirm. These controls take effect immediately when Postgres is reachable.

### Website generation

Pausing it stops free-site generation, bespoke-site challenge/generation, and style generation. Existing published sites, payments, Social Studio, chat, and admin keep running. Tap **Issues → Service isolation → Website generation → Isolate service**.

### Public publishing

Pausing it stops publishing challenges, new generated-site publishing, and draft/live visibility changes. Existing published sites, generation, Social Studio, and payments keep running. Tap **Issues → Service isolation → Public publishing → Isolate service**.

### Market feed

Pausing it stops the public market-feed route. Token creation, existing sites, payments, Social Studio, and chat keep running. Tap **Issues → Service isolation → Market feed → Isolate service**.

### Telegram publishing

Pausing it stops the older direct Telegram publishing endpoint. X, AI drafting, and the newer scheduled-post worker keep running unless **Social Studio posting** is also paused. Tap **Issues → Service isolation → Telegram publishing → Isolate service**.

### Hoodchat

Pausing it stops main Hoodchat reads, posts, and reports. Token chat, token creation, Social Studio, and published sites keep running. Tap **Issues → Service isolation → Hoodchat → Isolate service**.

### Token chat

Pausing it stops per-token chat reads, posts, and reports. Main Hoodchat, token pages, charts, and trade links keep running. Tap **Issues → Service isolation → Token chat → Isolate service**.

### Outreach

Pausing it stops the 30-minute outreach queue cron, admin outreach reads/actions, and approving outreach posts. User Social Studio posting, market data, and the rest of admin keep running. Tap **Issues → Service isolation → Outreach → Isolate service**.

### AI Social Studio

Pausing it stops voice learning, AI draft generation, mascot visual-DNA analysis, and mascot image generation. Existing drafts, manual writing, queue/history, connection management, and already-approved scheduled delivery keep running. Tap **Issues → Service isolation → AI Social Studio → Isolate service**.

### Social Studio posting

Pausing it stops X/Telegram connection changes, approving or cancelling scheduled posts, the every-minute posting cron, and delivery of due scheduled posts. Voice learning, AI drafts, mascot generation, and manual composer use keep running. Tap **Issues → Service isolation → Social Studio posting → Isolate service**.

### Wallet test-access allowlist

Pausing it stops allowlisted wallets receiving free test entitlement. Genuine paid subscriptions and payment history keep running, and allowlist entries remain stored for later restoration. Tap **Issues → Service isolation → Wallet test-access allowlist → Isolate service**. This control already fails closed if its state cannot be read.

## Vercel break-glass gates

On an iPhone, open Vercel, tap **tyrone-launchpad**, tap **launch-pad-o2gl**, tap **Settings**, tap **Environment Variables**, search the name, edit only the intended environment, tap **Save**, then redeploy Production. Environment changes are not live until a deployment uses them.

`TEST_ACCESS_HARD_DISABLED=true` forces all allowlisted test entitlement off even if `/admin` or the database is unavailable. Paid access keeps running.

`OUTREACH_QUEUE_ENABLED` must be exactly `true` to create new outreach drafts. Unset or any other value stops feed reads and new outreach queue writes. Existing drafts and user Social Studio posting remain.

All four `X_OUTREACH_API_KEY`, `X_OUTREACH_API_SECRET`, `X_OUTREACH_ACCESS_TOKEN`, and `X_OUTREACH_ACCESS_SECRET` must exist before an outreach tweet can send. Removing a credential is a break-glass stop, not the routine control; prefer the Outreach isolation switch when admin is working.

`SOCIAL_X_MONTHLY_COST_CAP_USD=0` stops paid X API sends because zero is a valid cap. Telegram delivery, AI drafting, and free X composer handoff keep running.

`SOCIAL_CREDENTIALS_ENCRYPTION_KEY` is required to read and store encrypted user connections. Removing or rotating it makes existing connections unreadable and forces reconnection, so use **Social Studio posting** isolation for a routine pause.

`X_SOCIAL_CONSUMER_KEY` and `X_SOCIAL_CONSUMER_SECRET` gate user X connection and paid X posting. `TELEGRAM_BOT_TOKEN` gates Telegram connection verification, scheduled Telegram delivery, legacy Telegram publishing, and renewal reminders. Credentials are not normal pause buttons.

`CRON_SECRET` gates subscription lifecycle, outreach, and Social Studio posting. If it is empty, all three routes return 401. Do not rotate or remove it merely to pause one feature; use that feature's isolation switch.

`HOODLUMS_SUBDOMAINS_ENABLED` controls wildcard `slug.hoodlums.dev` routing. The permanent `hoodlums.dev/slug` path remains. `HOODLUMS_PAYMENT_ALLOW_VERCEL_PREVIEWS` controls real payment sends from preview deployments and should remain off unless deliberately testing that risk.

## Safety gates that are automatic

Paid AI routes keep their shared-secret, Origin, entitlement, and per-IP limits. Social posts require wallet-signed approval before entering the durable queue. X posts containing links go to the user's free composer instead of the paid API. Each destination retries independently with bounded backoff and at most five attempts. Broken connections move to `reconnect_needed`. X has a per-wallet monthly cap. Payment routes retain exact-origin, wallet-proof, and on-chain verification. Admin writes retain admin-session and Origin checks. None of those protections should be disabled to work around an incident.

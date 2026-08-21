import type { ErrorCatalogueEntry } from "@/lib/server/support-knowledge/types";

// The Hoodlums error catalogue (issue #400): every distinct user-facing
// `error: "..."` JSON string returned by a non-admin, non-cron API route —
// i.e. every error a ticket-filing wallet can actually see (admin/cron
// routes are owner/system-only and never seen by a reporting user).
// tests/support-knowledge-error-catalogue-completeness.test.ts mechanically
// enforces that every such string in source is covered by an entry here
// (by exact match or pattern), and that every entry here still matches at
// least one real string in source — so a rename in either direction fails
// the suite instead of silently going stale.
//
// Many literally-distinct error strings across features share one root
// cause and fix (e.g. every "wallet challenge expired" variant, every
// "X origin is not allowed" variant) — those are covered by a single
// `pattern` entry rather than one entry per literal string, which is what
// keeps this catalogue reviewable instead of a 250-row near-duplicate list.

export const ERROR_CATALOGUE: ErrorCatalogueEntry[] = [
  // ---------------------------------------------------------------------
  // Shared wallet-signed-action / security / infra (issue #237's
  // challenge-response pattern, reused by hoodchat, token-chat, publish,
  // Social Studio and support tickets)
  // ---------------------------------------------------------------------
  {
    id: "wallet-challenge-expired",
    match: { type: "pattern", value: /challenge expired\./i },
    whichFeature: "shared",
    cause:
      "Every wallet-signed action (connect/disconnect, publish, approve/cancel/reschedule a post, hoodchat/token-chat posting, support tickets) issues a short-lived challenge nonce (about 5 minutes, lib/server/chat-auth.ts) that must be signed and submitted before it expires.",
    fix: "Not a bug — request a fresh challenge (usually automatic when the user retries the action) and sign it promptly.",
    userReplyTemplate:
      "That happens when the one-time signing request timed out before you approved it in your wallet. Please try the action again and approve the wallet prompt as soon as it appears.",
  },
  {
    id: "wallet-challenge-already-used",
    match: { type: "pattern", value: /challenge has already been used\./i },
    whichFeature: "shared",
    cause:
      "Challenge nonces are single-use (tryConsumeChatChallenge). This fires when the same challenge is submitted twice — usually a duplicate/double-tap submission, two open tabs racing, or the browser retrying a request automatically.",
    fix: "Not a bug — the user should start the action again to get a new challenge.",
    userReplyTemplate:
      "That one-time signing request was already used (often from a double-tap or two tabs open at once). Please start the action again — it'll issue a fresh request.",
  },
  {
    id: "wallet-authorisation-failed",
    match: { type: "pattern", value: /Wallet [\w\s]*authorisation failed\./i },
    whichFeature: "shared",
    cause:
      "The wallet's returned signature didn't verify against the issued challenge — wrong wallet signed, the message was altered in transit, or the wallet extension returned a malformed signature.",
    fix: "Ask which wallet/account was used to sign and confirm it's the same one connected in the app (see known-issue #388 below for a very common variant of this).",
    userReplyTemplate:
      "Your wallet's signature couldn't be verified. This is almost always caused by signing with a different account than the one connected in the app — please double check your wallet app is on the same account, then try again.",
  },
  {
    id: "origin-not-allowed",
    match: { type: "pattern", value: /origin is not allowed\./i },
    whichFeature: "shared",
    cause:
      "A same-origin check (lib/server/api-protection.ts) rejected the request's Origin header. In real traffic this is almost always a privacy extension/proxy stripping or rewriting the Origin header, or a request replayed from a cached/offline copy of the page.",
    fix: "Ask the user to try a different browser/device or temporarily disable aggressive privacy extensions, then hard-refresh hoodlums.dev.",
    userReplyTemplate:
      "Your browser's request was blocked by our origin check — this is usually a privacy extension or proxy altering request headers. Could you try again in a normal browser tab (or with extensions off) and let us know if it persists?",
  },
  {
    id: "rate-limited",
    match: { type: "pattern", value: /Too many [^.]*\.|rate limit exceeded\. Try again later\./i },
    whichFeature: "shared",
    cause:
      "A per-IP flood-protection limit (lib/server/api-protection.ts) was hit — most commonly one IP/device making rapid repeated requests (a double-tap loop, a stuck retry, or shared NAT/office wifi with many users).",
    fix: "Ask the user to wait a few minutes and try again; if it recurs immediately, check for a client-side retry loop bug.",
    userReplyTemplate:
      "You hit a temporary rate limit meant to stop request floods. Please wait a few minutes and try again — if it keeps happening right away, let us know exactly what you were doing.",
  },
  {
    id: "wallet-signed-action-shape-invalid",
    match: { type: "pattern", value: /(challenge|signature|payload|purpose)[^.]*required\./i },
    whichFeature: "shared",
    cause:
      "The wallet-signed-action request was missing a required field (challenge id, signature, or the challenge payload) — almost always a stale cached frontend build, or the wallet extension not returning a complete signature.",
    fix: "Ask the user to hard-refresh (clear cache) hoodlums.dev to pick up the latest build, then retry and fully approve the wallet prompt.",
    userReplyTemplate:
      "Part of that signed request didn't come through completely. Could you do a hard refresh of the page (or clear your browser cache) and try again, making sure to approve the full wallet signing prompt?",
  },
  {
    id: "wallet-address-required",
    match: { type: "pattern", value: /A valid wallet address is required\./i },
    whichFeature: "shared",
    cause: "The request was sent before a wallet was connected, or with a malformed address.",
    fix: "Ask the user to connect their wallet first.",
    userReplyTemplate: "You'll need to connect your wallet first for that action — please connect and try again.",
  },
  {
    id: "evm-wallet-chain-required",
    match: { type: "pattern", value: /A valid EVM wallet address( and wallet chain ID)? (is|are) required\./i },
    whichFeature: "shared",
    cause: "The wallet wasn't connected, or the app couldn't detect the connected chain ID, when a challenge was requested.",
    fix: "Ask the user to connect their wallet, confirm the correct network is selected, and retry.",
    userReplyTemplate:
      "We couldn't read a connected wallet and network. Please make sure your wallet is connected and on the right network, then try again.",
  },
  {
    id: "action-payload-not-strings",
    match: { type: "exact", value: "Action payload values must be strings." },
    whichFeature: "shared",
    cause: "The shared challenge route (lib/server/chat-auth.ts) received a non-string value in the action payload — a frontend bug or a stale cached build.",
    fix: "Ask the user to hard-refresh and retry; if it recurs, this needs a code-level look.",
    userReplyTemplate: "That's an unexpected client error on our side. Could you hard-refresh the page and try again? If it keeps happening, let us know what action you were taking.",
  },
  {
    id: "server-dependency-not-configured",
    match: { type: "pattern", value: /is not configured on this deployment\./i },
    whichFeature: "shared",
    cause:
      "A required server-side dependency for this feature (an AI provider key, or another required credential/service) is not set in this deployment's environment configuration. See the System Dependencies knowledge for the specific feature.",
    fix: "Owner-side environment configuration gap — not something the reporting wallet can fix. Check the specific feature's required env var.",
    userReplyTemplate:
      "That feature isn't fully configured on our end right now — this isn't something on your side. We're on it and will follow up here once it's resolved.",
  },
  {
    id: "storage-not-ready",
    match: { type: "pattern", value: /storage is not ready\. Apply the latest database migrations and try again\./i },
    whichFeature: "shared",
    cause: "DATABASE_URL isn't configured, or a required migration hasn't been applied in this environment yet.",
    fix: "Owner must confirm DATABASE_URL is set and run `npm run db:migrate`.",
    userReplyTemplate: "That's a temporary setup issue on our end, not something you did — we're on it.",
  },
  {
    id: "invalid-request-body",
    match: { type: "exact", value: "Invalid request body." },
    whichFeature: "shared",
    cause: "The request body wasn't parseable JSON — usually a flaky connection truncating the request, or a browser extension interfering with the request.",
    fix: "Ask the user to retry; if persistent, disable aggressive browser extensions and check the connection.",
    userReplyTemplate: "That looks like a request that didn't fully reach us — often a flaky connection. Please try again, and disable any aggressive ad/privacy extensions if it keeps happening.",
  },

  // ---------------------------------------------------------------------
  // AI Social Studio: mascot, voice profile, draft generation
  // ---------------------------------------------------------------------
  {
    id: "access-protection-not-configured",
    match: { type: "pattern", value: /access protection is not configured\./i },
    whichFeature: "social-studio",
    cause: "GENERATE_SITE_STYLE_SHARED_SECRET (the shared internal AI-generation proxy secret) isn't set in this deployment.",
    fix: "Owner-side environment configuration gap.",
    userReplyTemplate: "That's a temporary configuration issue on our end, not something on your side — we're on it.",
  },
  {
    id: "unauthorised-internal-request",
    match: { type: "pattern", value: /Unauthorised [^.]*request\./i },
    whichFeature: "social-studio",
    cause:
      "The internal shared-secret/Origin check on an AI-generation proxy route failed — practically only happens from a stale cached page hitting a redeployed origin/secret config, or a non-standard client.",
    fix: "Ask the user to hard-refresh the page.",
    userReplyTemplate: "Could you hard-refresh the page (or clear your cache) and try that again? That usually clears this up.",
  },
  {
    id: "studio-project-fields-required",
    match: { type: "exact", value: "A project name and ticker are required." },
    whichFeature: "social-studio",
    cause: "The Social Studio action was triggered before the project's name/ticker were filled in.",
    fix: "Ask the user to fill in the project name and ticker in Studio setup first.",
    userReplyTemplate: "You'll need a project name and ticker filled in first — please add those in Setup and try again.",
  },
  {
    id: "mascot-reference-image-required",
    match: { type: "pattern", value: /mascot reference image/i },
    whichFeature: "social-studio",
    cause: "No (or an invalid) reference photo was uploaded before locking the mascot's visual identity.",
    fix: "Ask the user to upload a PNG/JPG/WEBP reference image in Setup before generating a mascot scene.",
    userReplyTemplate: "You'll need to upload a mascot reference photo in Setup first, then lock its visual identity before generating scenes.",
  },
  {
    id: "mascot-scene-required",
    match: { type: "exact", value: "Choose or describe a scene for the mascot." },
    whichFeature: "social-studio",
    cause: "No scene chip was selected and no scene description was typed before generating a mascot image.",
    fix: "Ask the user to pick a scene chip or type a short description first.",
    userReplyTemplate: "Please pick a scene (or type a short description) before generating the mascot image.",
  },
  {
    id: "mascot-identity-extraction-failed",
    match: { type: "exact", value: "The AI could not extract a mascot identity from that image. Try a clearer image." },
    whichFeature: "social-studio",
    cause: "The model couldn't confidently describe the uploaded reference photo (too blurry, abstract, or no clear single subject).",
    fix: "Ask the user to upload a clearer, well-lit reference image with one distinct subject.",
    userReplyTemplate: "The AI couldn't clearly make out a mascot subject in that photo. Could you try a clearer, well-lit image with one distinct subject?",
  },
  {
    id: "mascot-image-generation-failed",
    match: { type: "exact", value: "Mascot image generation failed. Try again." },
    whichFeature: "social-studio",
    cause:
      "The gpt-image-1 call failed. Mascot image generation only works with a direct OPENAI_API_KEY (not the Vercel AI Gateway fallback) — see the system-dependency entry for this feature.",
    fix: "Ask the user to retry; if it never works on this deployment, confirm a direct OPENAI_API_KEY is configured (not just the gateway).",
    userReplyTemplate: "That generation attempt failed on our end. Please try again — if it keeps failing, let us know and we'll check our provider configuration.",
  },
  {
    id: "content-filter-output-blocked",
    match: { type: "pattern", value: /failed our content safety filter\. Try again\./i },
    whichFeature: "shared",
    cause:
      "Issue #392's deterministic content filter (slurs/hateful content, sexualisation of minors) matched something in the AI's own generated output — usually a false-ish trigger from an unusual name/ticker/description colliding with a blocked term.",
    fix: "Ask what project name/ticker/description was used; never share the matched term. If it recurs on legitimate input, escalate to the owner to review the filter term list (lib/server/content-filter.ts).",
    userReplyTemplate: "That generation was blocked by our safety filter. If you believe this was a false positive, could you tell us the project name/ticker/description you used so we can look into it?",
  },
  {
    id: "ai-provider-unreachable",
    match: { type: "pattern", value: /could not reach the AI provider\. Try again\./i },
    whichFeature: "social-studio",
    cause: "A network/timeout error occurred calling OpenAI or the Vercel AI Gateway.",
    fix: "Transient — ask the user to retry.",
    userReplyTemplate: "That request couldn't reach our AI provider — usually a brief network hiccup. Please try again in a moment.",
  },
  {
    id: "ai-request-failed",
    match: { type: "pattern", value: /request failed\. Try again\./i },
    whichFeature: "social-studio",
    cause: "The AI provider returned a non-2xx response (upstream rate limit, invalid key, or quota exhaustion).",
    fix: "Ask the user to retry; if persistent, escalate for a provider-side key/quota check.",
    userReplyTemplate: "That request failed on the AI provider's side. Please try again — if it keeps failing, let us know and we'll check our provider account.",
  },
  {
    id: "ai-invalid-response",
    match: { type: "exact", value: "The AI returned an invalid response." },
    whichFeature: "social-studio",
    cause: "The provider's response body wasn't parseable JSON — rare, usually transient.",
    fix: "Ask the user to retry.",
    userReplyTemplate: "We got back an unreadable response from the AI provider. Please try again.",
  },
  {
    id: "ai-retry-safety-fail",
    match: { type: "exact", value: "The AI draft failed a safety check, and the automatic retry could not produce a safe replacement. Try again." },
    whichFeature: "social-studio",
    cause:
      "Issue #364's mechanical draft-compliance checks (fact invention, banned phrase repetition, content filter) rejected both the first draft and the one automatic corrective retry.",
    fix: "Ask the user to retry generation, possibly with a shorter/simpler Direction brief.",
    userReplyTemplate: "The AI couldn't produce a draft that passed our safety checks after a retry. Please try generating again — simplifying your Direction brief can sometimes help.",
  },
  {
    id: "ai-safety-check-fail",
    match: { type: "exact", value: "The AI couldn't generate a draft that passed safety checks. Try again." },
    whichFeature: "social-studio",
    cause: "Same as the retry-safety-fail entry above — both mechanical compliance passes failed.",
    fix: "Ask the user to retry generation.",
    userReplyTemplate: "The AI couldn't produce a draft that passed our safety checks. Please try generating again.",
  },
  {
    id: "telegram-not-configured",
    match: { type: "pattern", value: /Telegram is not configured on this deployment/i },
    whichFeature: "social-studio",
    cause: "TELEGRAM_BOT_TOKEN isn't set in this deployment — Telegram connect/posting ships dormant until then.",
    fix: "Owner-side environment configuration gap.",
    userReplyTemplate: "Telegram connections aren't turned on for this deployment yet — that's on our side, not yours.",
  },
  {
    id: "telegram-channel-format-invalid",
    match: { type: "exact", value: "Use a public channel username such as @channel or a numeric chat ID." },
    whichFeature: "social-studio",
    cause: "The entered channel value didn't match the expected @channel or numeric chat ID format.",
    fix: "Ask the user to re-enter using the @channel or numeric chat ID format.",
    userReplyTemplate: "Please enter the channel as a public username like @yourchannel, or as its numeric chat ID.",
  },
  {
    id: "telegram-channel-not-found",
    match: { type: "exact", value: "Telegram could not find that channel." },
    whichFeature: "social-studio",
    cause: "Our bot isn't an admin of that channel yet (lib/server/social-telegram-connect.ts verifies admin status via getChat/getChatMember before storing the binding), or the channel doesn't exist / is private without the bot added.",
    fix: "Ask the user to add the Hoodlums bot as an admin of the channel first, then retry connect.",
    userReplyTemplate: "We couldn't verify that channel. Please add our Telegram bot as an admin of the channel first, then try connecting again.",
  },
  {
    id: "x-not-configured",
    match: { type: "exact", value: "X connections are not configured on this deployment." },
    whichFeature: "social-studio",
    cause: "X_SOCIAL_CONSUMER_KEY/SECRET aren't set in this deployment.",
    fix: "Owner-side environment configuration gap.",
    userReplyTemplate: "X connections aren't turned on for this deployment yet — that's on our side, not yours.",
  },

  // ---------------------------------------------------------------------
  // Social Studio scheduling/posting queue
  // ---------------------------------------------------------------------
  {
    id: "scheduled-time-invalid",
    match: { type: "pattern", value: /scheduled time is not a valid date\./i },
    whichFeature: "social-studio",
    cause: "The date/time picker produced an unparsable value, or the field was cleared before submitting.",
    fix: "Ask the user to reselect the date/time and retry.",
    userReplyTemplate: "That scheduled time didn't come through correctly. Could you reselect the date and time and try again?",
  },
  {
    id: "scheduled-post-not-found",
    match: { type: "pattern", value: /scheduled post could not be found\./i },
    whichFeature: "social-studio",
    cause: "The post was already canceled/sent, or the id is stale from an old page load in another tab.",
    fix: "Ask the user to refresh the Queue tab and retry the action from the current list.",
    userReplyTemplate: "That post couldn't be found — likely already changed in another tab. Please refresh the Queue tab and try again from the current list.",
  },
  {
    id: "post-already-terminal",
    match: { type: "pattern", value: /post has already sent, failed or been canceled\./i },
    whichFeature: "social-studio",
    cause: "Trying to cancel/reschedule a post no longer pending — usually a race between two tabs, or the posting cron already processed it.",
    fix: "Ask the user to refresh the Queue/History and check the outcome; no action needed if it already sent.",
    userReplyTemplate: "That post already reached a final state (sent, failed, or canceled) before this action ran. Check History for the outcome — no action needed if it sent successfully.",
  },
  {
    id: "post-reschedule-race",
    match: { type: "exact", value: "That post could not be rescheduled — it may already be sending." },
    whichFeature: "social-studio",
    cause: "The reschedule request raced the posting cron already picking up the post to send.",
    fix: "Ask the user to check History for the outcome; retry in a minute if it didn't send.",
    userReplyTemplate: "That post may already be in the process of sending, so it couldn't be rescheduled. Check History in a minute for the outcome.",
  },
  {
    id: "post-destination-required",
    match: { type: "exact", value: "Select at least one valid destination (x, telegram)." },
    whichFeature: "social-studio",
    cause: "A draft was approved with no destination toggled on, or the only toggled destination isn't actually connected.",
    fix: "Ask the user to toggle at least one connected destination before approving.",
    userReplyTemplate: "Please select at least one connected destination (X or Telegram) before approving that post.",
  },
  {
    id: "post-artwork-size-invalid",
    match: { type: "exact", value: "Artwork must be a PNG, JPG or WEBP image below 3 MB." },
    whichFeature: "social-studio",
    cause: "The attached mascot artwork exceeded the size/type limit when approving a post.",
    fix: "Ask the user to use a smaller/compressed PNG, JPG or WEBP.",
    userReplyTemplate: "That image is too large or an unsupported type — please use a PNG, JPG or WEBP under 3 MB.",
  },

  // ---------------------------------------------------------------------
  // Publishing
  // ---------------------------------------------------------------------
  {
    id: "publish-slug-taken",
    match: { type: "exact", value: "That website path is already published. Choose another slug." },
    whichFeature: "publishing",
    cause: "The chosen slug is already taken by another published site (published_sites.slug is uniquely constrained at the database level).",
    fix: "Ask the user to pick a different, unused slug.",
    userReplyTemplate: "That web address is already taken by another published site — please choose a different one.",
  },
  {
    id: "publish-owner-field-rejected",
    match: { type: "exact", value: "Do not submit an owner wallet address; ownership comes from the verified challenge." },
    whichFeature: "publishing",
    cause: "A client-side bug or stale cached build sent an owner field the server intentionally always ignores — ownership only ever comes from the verified wallet-signed challenge.",
    fix: "Ask the user to hard-refresh; this should never surface from normal use of the current UI.",
    userReplyTemplate: "That's an unexpected client error on our side — please hard-refresh the page and try again. Let us know if it recurs.",
  },
  {
    id: "publish-visibility-not-owner",
    match: { type: "exact", value: "The connected wallet is not the owner of this published site." },
    whichFeature: "publishing",
    cause: "The wallet trying to change a published site's visibility isn't the wallet that originally published it.",
    fix: "Ask the user to reconnect with the original publishing wallet.",
    userReplyTemplate: "Only the wallet that originally published a site can change its visibility. Please reconnect with that wallet and try again.",
  },
  {
    id: "publish-site-not-found",
    match: { type: "exact", value: "The published site was not found." },
    whichFeature: "publishing",
    cause: "The slug doesn't exist or was never published — often a stale/mistyped link.",
    fix: "Ask the user to confirm the slug from their Studio's publish confirmation.",
    userReplyTemplate: "We couldn't find a published site at that address. Could you double-check the link from your Studio's publish confirmation?",
  },

  // ---------------------------------------------------------------------
  // Plans / payments
  // ---------------------------------------------------------------------
  {
    id: "plan-payments-not-configured",
    match: { type: "exact", value: "Payments are not configured for this plan on this deployment." },
    whichFeature: "payments",
    cause: "Server-side payment configuration is missing for that specific plan id in this deployment.",
    fix: "Owner-side environment configuration gap.",
    userReplyTemplate: "That plan isn't fully configured for payment on our end right now — this isn't something on your side. We're on it.",
  },
  {
    id: "plan-unknown",
    match: { type: "exact", value: "Unknown paid plan." },
    whichFeature: "payments",
    cause: "The client requested a plan id that doesn't exist — usually a renamed/removed plan and a stale cached pricing page.",
    fix: "Ask the user to refresh the pricing page and retry with a current plan.",
    userReplyTemplate: "That plan wasn't recognised — could you refresh the pricing page and try selecting your plan again?",
  },
  {
    id: "plan-payments-invalid-json",
    match: { type: "exact", value: "Invalid JSON body." },
    whichFeature: "payments",
    cause: "The payment verification request wasn't valid JSON — usually a stale cached frontend bundle.",
    fix: "Ask the user to hard-refresh and retry payment verification.",
    userReplyTemplate: "That payment verification request didn't come through correctly. Please hard-refresh the page and try again.",
  },
  {
    id: "subscription-status-unavailable",
    match: { type: "exact", value: "Subscription status is temporarily unavailable." },
    whichFeature: "payments",
    cause: "A database/lookup failure reading subscription state — transient, or DATABASE_URL/migrations misconfigured.",
    fix: "Ask the user to retry shortly; if persistent, check DATABASE_URL and migrations.",
    userReplyTemplate: "We're temporarily unable to check subscription status — please try again shortly. If it persists, let us know.",
  },

  // ---------------------------------------------------------------------
  // Hoodchat / token chat
  // ---------------------------------------------------------------------
  {
    id: "message-category-required",
    match: { type: "pattern", value: /A valid message category is required\./i },
    whichFeature: "hoodchat",
    cause: "No category was selected before posting to Hoodchat.",
    fix: "Ask the user to pick a category before posting.",
    userReplyTemplate: "Please pick a message category before posting.",
  },
  {
    id: "chat-message-id-required",
    match: { type: "pattern", value: /A valid message ID is required\./i },
    whichFeature: "hoodchat",
    cause: "The report action sent a stale or missing message id.",
    fix: "Ask the user to refresh the chat and try reporting again.",
    userReplyTemplate: "Please refresh the chat and try reporting that message again.",
  },
  {
    id: "chat-message-not-found",
    match: { type: "exact", value: "Message not found." },
    whichFeature: "hoodchat",
    cause: "The message was already removed or auto-hidden (3+ reports, lib/server/chat-moderation.ts) before this report was submitted.",
    fix: "No action needed — it's already been actioned.",
    userReplyTemplate: "That message has already been removed or hidden — no further action is needed on your report.",
  },
  {
    id: "chain-contract-required",
    match: { type: "pattern", value: /A valid chain and contract address are required\./i },
    whichFeature: "token-chat",
    cause: "Token chat was opened without a resolvable chain/contract address — usually an old or malformed link.",
    fix: "Ask the user to reopen the token page from a fresh link.",
    userReplyTemplate: "That token chat link looks incomplete. Could you reopen the token page from a fresh link and try again?",
  },
  {
    id: "chat-hourly-limit",
    match: { type: "pattern", value: /You can post up to \d+ .*per hour/i },
    whichFeature: "shared",
    cause: "The per-wallet 5-messages-per-hour Hoodchat/token-chat posting limit (a product rule, not a bug) was hit.",
    fix: "Ask the user to wait for the hourly window to reset.",
    userReplyTemplate: "You've hit the hourly posting limit for chat (5 messages/hour per wallet). Please wait for the window to reset and try again.",
  },

  // ---------------------------------------------------------------------
  // Site builder (free-site + bespoke generation)
  // ---------------------------------------------------------------------
  {
    id: "artwork-image-required",
    match: { type: "exact", value: "A valid optimised artwork image is required." },
    whichFeature: "site-builder",
    cause: "Generation was triggered before the client-side artwork compression/upload step finished.",
    fix: "Ask the user to wait for the artwork preview to finish processing before generating, or re-upload.",
    userReplyTemplate: "It looks like your artwork hadn't finished processing yet. Please wait for the artwork preview to appear (or re-upload it), then try generating again.",
  },
  {
    id: "freesite-render-failed",
    match: { type: "exact", value: "The generated free-site theme or copy could not be rendered." },
    whichFeature: "site-builder",
    cause: "The AI's structured JSON output didn't satisfy the free-site template's rendering requirements.",
    fix: "Ask the user to retry generation; if persistent, try a different project description/artwork.",
    userReplyTemplate: "That generation attempt didn't produce a usable result. Please try generating again — if it keeps happening, a different description or artwork sometimes helps.",
  },
  {
    id: "freesite-validation-failed",
    match: { type: "exact", value: "The generated free-site document failed server-side validation." },
    whichFeature: "site-builder",
    cause: "The generated HTML failed the responsive/structural safety checks (issue #323/#326/#338's isCompleteGeneratedPageHtml gate).",
    fix: "Ask the user to retry generation.",
    userReplyTemplate: "That generated page didn't pass our layout quality checks. Please try generating again.",
  },
  {
    id: "ai-style-fallback",
    match: { type: "exact", value: "AI style generation is not configured. The browser artwork matcher will be used." },
    whichFeature: "site-builder",
    cause: "No AI provider is configured, so the app is intentionally falling back to a client-side colour matcher — this is expected, working behaviour, not a failure.",
    fix: "Not actionable — informational fallback, not a bug.",
    userReplyTemplate: "That's expected — AI styling isn't enabled on this deployment, so we automatically use a built-in colour matcher instead. Your site still generates normally.",
  },
  {
    id: "inspiration-url-invalid",
    match: { type: "exact", value: "Enter a valid public http or https inspiration website URL." },
    whichFeature: "site-builder",
    cause: "The \"match this site's style\" URL field had an invalid, non-public, or non-http(s) URL.",
    fix: "Ask the user to enter a full https:// URL to a real, public website.",
    userReplyTemplate: "Please enter a full https:// link to a real, publicly reachable website for style inspiration.",
  },
  {
    id: "inspiration-not-inspected",
    match: { type: "exact", value: "The inspiration website could not be inspected. Check that it is public and try again." },
    whichFeature: "site-builder",
    cause: "The server-side fetch of the given inspiration URL failed — private site, blocked, or down.",
    fix: "Ask the user to try a different publicly reachable URL, or skip the inspiration-site step.",
    userReplyTemplate: "We couldn't reach that inspiration website from our server. Could you try a different public URL, or skip that step?",
  },
  {
    id: "inspiration-skip-no-generation",
    match: { type: "exact", value: "The inspiration website was not inspected, so no full website was generated." },
    whichFeature: "site-builder",
    cause: "Follows a failed inspection step above — generation was correctly aborted rather than proceeding without the requested style reference.",
    fix: "Ask the user to retry after confirming the inspiration URL works, or skip it.",
    userReplyTemplate: "Since we couldn't inspect that inspiration site, generation didn't proceed. Please retry with a working URL, or skip that step.",
  },
  {
    id: "ai-design-invalid",
    match: { type: "exact", value: "AI returned an invalid design. Try generating the website again." },
    whichFeature: "site-builder",
    cause: "The provider's JSON output didn't validate against the design schema (isSiteStyle).",
    fix: "Ask the user to retry generation.",
    userReplyTemplate: "That design attempt didn't come back in a usable format. Please try generating the website again.",
  },
  {
    id: "sitepage-unexpected-error",
    match: { type: "exact", value: "The standalone website could not be generated because of an unexpected server error. Try again." },
    whichFeature: "site-builder",
    cause: "An unhandled exception during bespoke page generation (e.g. a network glitch to the AI provider).",
    fix: "Ask the user to retry; capture the exact time so the owner can check server logs if it recurs.",
    userReplyTemplate: "That generation hit an unexpected error on our end. Please try again — if it keeps happening, let us know roughly when it occurred so we can check our logs.",
  },
  {
    id: "ai-provider-unavailable-detailed",
    match: { type: "pattern", value: /neither OpenAI nor Vercel AI Gateway authentication is available\./i },
    whichFeature: "site-builder",
    cause: "No AI provider credentials are configured in this deployment (no OPENAI_API_KEY, AI Gateway key, or Vercel OIDC token).",
    fix: "Owner-side environment configuration gap.",
    userReplyTemplate: "AI generation isn't fully configured on our end right now — this isn't something on your side. We're on it.",
  },
  {
    id: "sitepage-generation-rejected",
    match: {
      type: "exact",
      value:
        "AI returned a website that was incomplete, unsafe, still resembled the legacy terminal fallback, or did not apply the inspiration structure. Try again.",
    },
    whichFeature: "site-builder",
    cause: "The generated page failed one of the structural completeness/safety/layout checks (isCompleteGeneratedPageHtml) even after the automatic corrective retry.",
    fix: "Ask the user to retry generation; a different description, artwork, or inspiration URL sometimes helps.",
    userReplyTemplate: "That generation attempt didn't produce a page that passed our quality checks. Please try generating again — a different description, artwork, or inspiration site sometimes helps.",
  },
  {
    id: "sitestyle-artwork-analysis-failed",
    match: { type: "exact", value: "The uploaded artwork could not be analysed for collaboration. Re-upload it and try again." },
    whichFeature: "site-builder",
    cause: "The AI couldn't extract a usable visual identity from the uploaded artwork for the style-matching step.",
    fix: "Ask the user to re-upload a clearer artwork image.",
    userReplyTemplate: "We couldn't analyse that artwork for style matching. Could you try re-uploading it (or a clearer version) and generating again?",
  },
  {
    id: "sitestyle-inspiration-skip-no-generation",
    match: { type: "exact", value: "The inspiration website was not inspected, so no collaborative design was generated. Try the URL again or remove it." },
    whichFeature: "site-builder",
    cause: "The inspiration-site inspection step failed, so style generation was correctly aborted rather than proceeding without it.",
    fix: "Ask the user to retry with a working inspiration URL, or remove that field and generate without one.",
    userReplyTemplate: "Since we couldn't inspect that inspiration site, style generation didn't proceed. Please try the URL again, or remove it and generate without one.",
  },
  {
    id: "sitestyle-artwork-identity-failed",
    match: { type: "exact", value: "The artwork identity could not be extracted, so it could not collaborate with the inspiration website." },
    whichFeature: "site-builder",
    cause: "The artwork-identity extraction step failed, so it couldn't be combined with the inspiration-site style step.",
    fix: "Ask the user to retry, or re-upload a clearer artwork image.",
    userReplyTemplate: "We couldn't extract a clear identity from that artwork to combine with your inspiration site. Please try again, or re-upload a clearer image.",
  },
  {
    id: "plan-payments-verify-fields-required",
    match: {
      type: "exact",
      value: "Plan, walletAddress, transactionHash and walletSignature are required; paymentToken must be a string when supplied.",
    },
    whichFeature: "payments",
    cause: "The payment verification request was missing a required field — usually a stale cached frontend bundle, or the wallet transaction/signature step didn't fully complete client-side.",
    fix: "Ask the user to hard-refresh and retry the payment flow from the start.",
    userReplyTemplate: "Part of your payment verification request didn't come through completely. Please hard-refresh the page and retry the payment flow from the start.",
  },
  {
    id: "plan-payments-verify-failed-safely",
    match: { type: "exact", value: "Payment verification failed safely. The transaction hash remains recoverable and no second payment is required." },
    whichFeature: "payments",
    cause: "The on-chain payment itself likely succeeded, but the server-side verification step failed (e.g. a transient RPC error) — the transaction hash is retained so verification can be retried without paying again.",
    fix: "Ask the user for the transaction hash and retry verification; never ask them to pay a second time.",
    userReplyTemplate: "Your payment likely went through, but our verification step failed. You do NOT need to pay again — please share your transaction hash so we can re-verify it manually if it doesn't resolve on retry.",
  },
  {
    id: "mascot-image-direct-openai-required",
    match: {
      type: "exact",
      value: "Mascot image generation needs a direct OpenAI API key on this deployment; it isn't available through the fallback AI gateway yet.",
    },
    whichFeature: "social-studio",
    cause: "Mascot image generation (gpt-image-1) only works with a direct OPENAI_API_KEY — the Vercel AI Gateway fallback used by other AI features doesn't support it yet.",
    fix: "Owner-side environment configuration gap — a direct OPENAI_API_KEY must be set.",
    userReplyTemplate: "Mascot image generation needs a specific provider configuration that isn't fully set up on this deployment yet — this isn't something on your side. We're on it.",
  },

  // ---------------------------------------------------------------------
  // Market data
  // ---------------------------------------------------------------------
  {
    id: "address-lookup-invalid",
    match: { type: "exact", value: "Enter a valid contract or mint address." },
    whichFeature: "market-data",
    cause: "A malformed address was typed/pasted into a token lookup.",
    fix: "Ask the user to double-check the address.",
    userReplyTemplate: "That address doesn't look valid — could you double-check and re-paste it?",
  },
  {
    id: "dexscreener-unreachable",
    match: { type: "exact", value: "Dexscreener could not be reached right now." },
    whichFeature: "market-data",
    cause: "The upstream Dexscreener API timed out or was unavailable.",
    fix: "Transient — ask the user to retry shortly.",
    userReplyTemplate: "Our market data source is temporarily unreachable — please try again in a moment.",
  },

  // ---------------------------------------------------------------------
  // Client-side crash reporting (the pipe itself, not a feature failure)
  // ---------------------------------------------------------------------
  {
    id: "client-error-report-shape-invalid",
    match: { type: "exact", value: "A valid message and routePath are required." },
    whichFeature: "diagnostics",
    cause: "The client-side crash reporter sent a malformed payload — a frontend bug in the reporter itself, not user-actionable.",
    fix: "Not user-actionable; log for the owner to check the reporter's payload shape.",
    userReplyTemplate: "That's an internal diagnostic-reporting issue on our side, not something you need to do anything about.",
  },
  {
    id: "client-error-wallet-invalid",
    match: { type: "exact", value: "walletAddress must be a valid address." },
    whichFeature: "diagnostics",
    cause: "The client-side crash reporter sent a malformed wallet address alongside a crash report.",
    fix: "Not user-actionable.",
    userReplyTemplate: "That's an internal diagnostic-reporting issue on our side, not something you need to do anything about.",
  },
  {
    id: "client-error-store-failed",
    match: { type: "exact", value: "The error report could not be recorded." },
    whichFeature: "diagnostics",
    cause: "The crash-report store (Postgres) failed to accept the write.",
    fix: "Owner should check DATABASE_URL/migrations if this recurs.",
    userReplyTemplate: "That's an internal diagnostic-reporting issue on our side, not something you need to do anything about.",
  },

  // ---------------------------------------------------------------------
  // Support tickets themselves
  // ---------------------------------------------------------------------
  {
    id: "support-tickets-load-failed",
    match: { type: "exact", value: "Your support tickets could not be loaded. Try again." },
    whichFeature: "support-tickets",
    cause: "A transient read failure loading the wallet's own ticket list.",
    fix: "Ask the user to retry.",
    userReplyTemplate: "We had trouble loading your tickets just now — please try again.",
  },
  {
    id: "support-category-required",
    match: { type: "exact", value: "A valid category is required." },
    whichFeature: "support-tickets",
    cause: "No ticket category was selected when submitting a new ticket.",
    fix: "Ask the user to choose a category before submitting.",
    userReplyTemplate: "Please choose a category before submitting your ticket.",
  },
  {
    id: "support-ticket-submit-failed",
    match: { type: "exact", value: "Your support ticket could not be submitted. Try again." },
    whichFeature: "support-tickets",
    cause: "A transient write failure creating the ticket.",
    fix: "Ask the user to retry.",
    userReplyTemplate: "That didn't save on our end — please try submitting again.",
  },
  {
    id: "ticket-id-required",
    match: { type: "exact", value: "A valid ticket id is required." },
    whichFeature: "support-tickets",
    cause: "The reply request was missing/had a malformed ticket id — a stale link or cached build.",
    fix: "Ask the user to reopen the ticket from /support and retry.",
    userReplyTemplate: "Please reopen this ticket from the Support page and try replying again.",
  },
  {
    id: "ticket-not-found",
    match: { type: "exact", value: "That support ticket could not be found." },
    whichFeature: "support-tickets",
    cause: "The ticket id doesn't exist — a stale link.",
    fix: "Ask the user to reopen /support and find the ticket from their current list.",
    userReplyTemplate: "We couldn't find that ticket. Could you reopen the Support page and reply from your current ticket list?",
  },
  {
    id: "ticket-wrong-wallet",
    match: { type: "exact", value: "That support ticket does not belong to this wallet." },
    whichFeature: "support-tickets",
    cause: "The connected wallet doesn't match the wallet that filed the ticket — often switching wallets/accounts between visits.",
    fix: "Ask the user to reconnect with the same wallet that originally filed the ticket.",
    userReplyTemplate: "That ticket was filed from a different wallet. Please reconnect with the same wallet you used to submit it.",
  },
  {
    id: "ticket-terminal-status",
    match: { type: "exact", value: "This ticket is solved or closed and can no longer be replied to." },
    whichFeature: "support-tickets",
    cause: "The user tried to reply to a ticket the owner already marked solved/closed.",
    fix: "If genuinely unresolved, ask the owner to reopen by replying from /admin (which flips it back to needs_user).",
    userReplyTemplate: "That ticket is marked solved/closed. If this isn't actually resolved, please open a new ticket referencing this one and we'll follow up.",
  },
  {
    id: "support-reply-failed",
    match: { type: "exact", value: "Your reply could not be sent. Try again." },
    whichFeature: "support-tickets",
    cause: "A transient write failure saving the reply.",
    fix: "Ask the user to retry.",
    userReplyTemplate: "That reply didn't save on our end — please try sending it again.",
  },
];

/** All entries whose exact string appears in `text`, or whose pattern matches somewhere in `text`. Used both by deterministic ticket-body selection and by the completeness test's reverse check. */
export function matchErrorCatalogueEntries(text: string): ErrorCatalogueEntry[] {
  return ERROR_CATALOGUE.filter((entry) =>
    entry.match.type === "exact" ? text.includes(entry.match.value) : entry.match.value.test(text),
  );
}

export function findErrorCatalogueEntryById(id: string): ErrorCatalogueEntry | null {
  return ERROR_CATALOGUE.find((entry) => entry.id === id) ?? null;
}

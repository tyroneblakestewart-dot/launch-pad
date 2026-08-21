import type { SystemDependencyEntry } from "@/lib/server/support-knowledge/types";

// Which features need which env/config, and what happens when it's missing
// (issue #400). Grounding material for the admin "Suggest a fix" AI —
// lets a suggestion correctly say "this is an owner-side config gap, not
// something on your end" instead of guessing.

export const SYSTEM_DEPENDENCIES: SystemDependencyEntry[] = [
  {
    id: "ai-provider",
    feature: "site-builder / social-studio",
    requiredEnv: ["OPENAI_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"],
    whenMissing:
      "resolveAIResponsesRuntime() returns null. Free-site generation falls back to a client-side artwork colour matcher (still works, no AI styling). Bespoke generation, voice-profile, draft generation and mascot analysis all return a 503 'is not configured on this deployment' error and cannot proceed at all.",
    symptom: "A user reports AI-powered generation (bespoke site, voice profile, drafts, mascot analysis) failing outright with a 'not configured' error; free-site generation and templated features keep working.",
  },
  {
    id: "mascot-image-direct-openai",
    feature: "social-studio",
    requiredEnv: ["OPENAI_API_KEY"],
    whenMissing:
      "Mascot scene image generation (gpt-image-1 via lib/server/mascot-image-request.ts) only works with a direct OpenAI key — the Vercel AI Gateway fallback that other AI features use does not support it. Without a direct key, mascot image generation fails closed with a clear 503 even if the Gateway is otherwise configured and working for text generation.",
    symptom: "A user reports the mascot's text-based features (voice profile, drafts) working fine, but mascot scene image generation always failing.",
  },
  {
    id: "database",
    feature: "shared",
    requiredEnv: ["DATABASE_URL"],
    whenMissing:
      "Every durable-storage feature (publishing, hoodchat, token chat, subscriptions, support tickets, Social Studio connections/queue, admin dashboard sessions) returns a 503 'storage is not ready' error. Migrations must also be applied (npm run db:migrate) — a configured DATABASE_URL with an unapplied migration produces the same symptom for that specific feature's table.",
    symptom: "A user reports a durable-storage feature (publish, chat post, ticket submit, connect a platform) failing with a storage/migration error, while wallet-only features (connecting a wallet, previewing a generated site) keep working.",
  },
  {
    id: "telegram-bot",
    feature: "social-studio",
    requiredEnv: ["TELEGRAM_BOT_TOKEN"],
    whenMissing: "Telegram connect/posting ships dormant — every Telegram-related route returns a 'not configured' error until this is set.",
    symptom: "A user reports Telegram connect never working, while X connect (if configured) works fine.",
  },
  {
    id: "telegram-admin-alert",
    feature: "support-tickets",
    requiredEnv: ["TELEGRAM_ADMIN_CHAT_ID"],
    whenMissing: "Ticket creation still succeeds and saves normally — only the best-effort owner Telegram alert is silently skipped.",
    symptom: "Tickets are being created and are visible in /admin → Support, but the owner isn't getting notified via Telegram.",
  },
  {
    id: "x-social-credentials",
    feature: "social-studio",
    requiredEnv: ["X_SOCIAL_CONSUMER_KEY", "X_SOCIAL_CONSUMER_SECRET"],
    whenMissing: "X connect/posting ships dormant — connect attempts return 'X connections are not configured on this deployment.'",
    symptom: "A user reports X connect never working, while Telegram connect (if configured) works fine.",
  },
  {
    id: "generate-site-style-shared-secret",
    feature: "shared",
    requiredEnv: ["GENERATE_SITE_STYLE_SHARED_SECRET"],
    whenMissing: "The internal shared-secret proxy protecting every AI-generation route returns 503 'access protection is not configured' for all of them.",
    symptom: "Every AI-generation feature (site style, free site, bespoke site, voice profile, drafts, mascot) fails at once with the same 'access protection' error — a single root cause across many symptoms.",
  },
  {
    id: "social-credentials-encryption-key",
    feature: "social-studio",
    requiredEnv: ["SOCIAL_CREDENTIALS_ENCRYPTION_KEY"],
    whenMissing: "Stored X/Telegram credentials fail to decrypt (fails closed, never throws into a crash) — connections behave as if disconnected/broken even though a row exists.",
    symptom: "A user reports a platform they previously connected now showing as disconnected or needing reconnect, with no action on their end.",
  },
  {
    id: "x-monthly-cost-cap",
    feature: "social-studio",
    requiredEnv: ["SOCIAL_X_MONTHLY_COST_CAP_USD"],
    whenMissing: "Uses a sensible default cap. Once the configured (or default) monthly per-wallet X API spend cap is reached, further X sends pause (not fail) until next month — Telegram sends are unaffected.",
    symptom: "A user reports X posts sitting in 'scheduled' far longer than expected while Telegram posts from the same queue send normally.",
  },
];

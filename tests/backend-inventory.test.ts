import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(absolute);
      return [absolute];
    }),
  );
  return files.flat();
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

describe("backend test inventory", () => {
  it("lists every current API route and its exported HTTP method", async () => {
    const routeFiles = (await walk(path.join(ROOT, "app", "api")))
      .filter((file) => file.endsWith(`${path.sep}route.ts`))
      .map(relative)
      .sort();

    expect(routeFiles).toEqual([
      "app/api/account-content/route.ts",
      "app/api/admin/challenge/route.ts",
      "app/api/admin/health/pipeline/route.ts",
      "app/api/admin/health/route.ts",
      "app/api/admin/login/route.ts",
      "app/api/admin/logout/route.ts",
      "app/api/admin/operations/route.ts",
      "app/api/admin/pages/actions/route.ts",
      "app/api/admin/pages/route.ts",
      "app/api/admin/subscribers/route.ts",
      "app/api/cron/subscription-lifecycle/route.ts",
      "app/api/dexscreener-pair/route.ts",
      "app/api/generate-free-site/route.ts",
      "app/api/generate-site-page/route.ts",
      "app/api/generate-site-style/route.ts",
      "app/api/generation-status/route.ts",
      "app/api/hoodchat/challenge/route.ts",
      "app/api/hoodchat/messages/route.ts",
      "app/api/hoodchat/report/route.ts",
      "app/api/plan-payments/preflight/route.ts",
      "app/api/plan-payments/quote/route.ts",
      "app/api/plan-payments/verify/route.ts",
      "app/api/publish/challenge/route.ts",
      "app/api/publish/route.ts",
      "app/api/publish/visibility/route.ts",
      "app/api/social/telegram/route.ts",
      "app/api/subscriptions/status/route.ts",
      "app/api/telegram/subscription-webhook/route.ts",
      "app/api/token-chat/challenge/route.ts",
      "app/api/token-chat/messages/route.ts",
      "app/api/token-chat/report/route.ts",
      "app/api/trending-robinhood/route.ts",
    ]);

    const methods = await Promise.all(
      routeFiles.map(async (file) => {
        const source = await readFile(path.join(ROOT, file), "utf8");
        const exported = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)]
          .map((match) => match[1])
          .sort();
        return [file, exported] as const;
      }),
    );

    expect(Object.fromEntries(methods)).toEqual({
      "app/api/account-content/route.ts": ["GET"],
      "app/api/admin/challenge/route.ts": ["POST"],
      "app/api/admin/health/pipeline/route.ts": ["GET"],
      "app/api/admin/health/route.ts": ["GET"],
      "app/api/admin/login/route.ts": ["POST"],
      "app/api/admin/logout/route.ts": ["POST"],
      "app/api/admin/operations/route.ts": ["GET", "PATCH"],
      "app/api/admin/pages/actions/route.ts": ["POST"],
      "app/api/admin/pages/route.ts": ["GET", "PATCH"],
      "app/api/admin/subscribers/route.ts": ["GET"],
      "app/api/cron/subscription-lifecycle/route.ts": ["GET"],
      "app/api/dexscreener-pair/route.ts": ["GET"],
      "app/api/generate-free-site/route.ts": ["POST"],
      "app/api/generate-site-page/route.ts": ["POST"],
      "app/api/generate-site-style/route.ts": ["POST"],
      "app/api/generation-status/route.ts": ["GET"],
      "app/api/hoodchat/challenge/route.ts": ["POST"],
      "app/api/hoodchat/messages/route.ts": ["GET", "POST"],
      "app/api/hoodchat/report/route.ts": ["POST"],
      "app/api/plan-payments/preflight/route.ts": ["POST"],
      "app/api/plan-payments/quote/route.ts": ["GET"],
      "app/api/plan-payments/verify/route.ts": ["POST"],
      "app/api/publish/challenge/route.ts": ["POST"],
      "app/api/publish/route.ts": ["POST"],
      "app/api/publish/visibility/route.ts": ["POST"],
      "app/api/social/telegram/route.ts": ["POST"],
      "app/api/subscriptions/status/route.ts": ["GET"],
      "app/api/telegram/subscription-webhook/route.ts": ["POST"],
      "app/api/token-chat/challenge/route.ts": ["POST"],
      "app/api/token-chat/messages/route.ts": ["GET", "POST"],
      "app/api/token-chat/report/route.ts": ["POST"],
      "app/api/trending-robinhood/route.ts": ["GET"],
    });
  });

  it("lists every extracted server module covered by the suite", async () => {
    const serverFiles = (await walk(path.join(ROOT, "lib", "server")))
      .filter((file) => file.endsWith(".ts"))
      .map(relative)
      .sort();

    expect(serverFiles).toEqual([
      "lib/server/admin-auth.ts",
      "lib/server/admin-operations-store.ts",
      "lib/server/admin-operations.ts",
      "lib/server/admin-session-store.ts",
      "lib/server/ai-responses-runtime.ts",
      "lib/server/api-protection.ts",
      "lib/server/artwork-identity-request.ts",
      "lib/server/chat-auth.ts",
      "lib/server/chat-moderation.ts",
      "lib/server/dexscreener.ts",
      "lib/server/generate-site-page-stream.ts",
      "lib/server/generate-site-style.ts",
      "lib/server/hoodchat-store.ts",
      "lib/server/mascot-prompt-builder.ts",
      "lib/server/page-content-sanitise.ts",
      "lib/server/page-content-store.ts",
      "lib/server/page-content.ts",
      "lib/server/plan-payment-config.ts",
      "lib/server/plan-payment-origin.ts",
      "lib/server/plan-payment-proof.ts",
      "lib/server/plan-payments.ts",
      "lib/server/postgres-publish-store.ts",
      "lib/server/postgres.ts",
      "lib/server/public-generated-sites.ts",
      "lib/server/public-site-artwork.ts",
      "lib/server/publish-auth.ts",
      "lib/server/publish-store.ts",
      "lib/server/published-site-validation.ts",
      "lib/server/robinhood-trending.ts",
      "lib/server/sanitise-provider-detail.ts",
      "lib/server/service-isolation.ts",
      "lib/server/subscribers.ts",
      "lib/server/subscription-lifecycle-pipeline.ts",
      "lib/server/subscription-lifecycle.ts",
      "lib/server/subscription-telegram.ts",
      "lib/server/system-health-pipeline.ts",
      "lib/server/system-health.ts",
      "lib/server/telegram.ts",
      "lib/server/token-chat-creator.ts",
      "lib/server/token-chat-store.ts",
      "lib/server/token-holders.ts",
      "lib/server/token-market-stats.ts",
    ]);
  });
});

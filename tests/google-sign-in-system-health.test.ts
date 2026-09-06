import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_SERVICE_DEFINITIONS, SYSTEM_HEALTH_CHECK_IDS } from "@/lib/admin-operations";
import { ACCOUNT_ACTION_PURPOSES } from "@/lib/server/account-link-auth";
import { checkGoogleSignInHealth } from "@/lib/server/system-health";
import { buildGoogleSignInPipeline, buildServicePipeline } from "@/lib/server/system-health-pipeline";
import { createMemoryUserAccountsStore } from "./user-accounts-test-helpers";

// Sign in with Google, phase 1 (6 Sep 2026), rule 10: the admin cockpit
// registration, health check, pipeline and migration shape.

const NOW = new Date("2026-09-06T12:00:00Z");
const CONFIGURED = { GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "secret", SOCIAL_CREDENTIALS_ENCRYPTION_KEY: "a".repeat(44), DATABASE_URL: "postgres://x" };

const notIsolated = async (key: string) =>
  ({ key, label: key, description: "", affectedRoutes: "", isolated: false, reason: "", updatedAt: NOW.toISOString() }) as never;

async function source(...parts: string[]) {
  return readFile(path.join(process.cwd(), ...parts), "utf8");
}

describe("Google sign-in registration in the admin cockpit (rule 10)", () => {
  it("adds the google-sign-in service key covering every account route, the health check id, and the link purpose", () => {
    const definition = ADMIN_SERVICE_DEFINITIONS.find((item) => item.key === "google-sign-in");
    expect(definition?.label).toBe("Google sign-in");
    for (const route of [
      "/api/account/google/start",
      "/api/account/google/callback",
      "/api/account/session",
      "/api/account/logout",
      "/api/account/challenge",
      "/api/account/link-wallet",
      "/api/account/unlink-wallet",
      "/api/account/delete",
    ]) {
      expect(definition?.affectedRoutes, route).toContain(route);
    }
    expect(SYSTEM_HEALTH_CHECK_IDS).toContain("google-sign-in");
    expect(ACCOUNT_ACTION_PURPOSES).toEqual(["account:link-wallet"]);
  });

  it("declares the four Activity log kinds", async () => {
    const admin = await source("lib", "admin-operations.ts");
    for (const kind of ["account-google-signed-in", "account-wallet-linked", "account-wallet-unlinked", "account-deleted"]) {
      expect(admin).toContain(`| "${kind}"`);
    }
  });

  it("ships an idempotent migration 033 with both tables, the one-account-per-wallet partial index, cascading sessions and the widened service constraints", async () => {
    const sql = await source("db", "migrations", "033_user_accounts.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS user_accounts");
    expect(sql).toContain("google_sub VARCHAR(64) NOT NULL UNIQUE");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS user_accounts_linked_wallet_idx");
    expect(sql).toContain("ON user_accounts (LOWER(linked_wallet_address))");
    expect(sql).toContain("WHERE linked_wallet_address IS NOT NULL");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS user_sessions");
    expect(sql).toContain("session_token_hash CHAR(64) PRIMARY KEY");
    expect(sql).toContain("REFERENCES user_accounts (id) ON DELETE CASCADE");
    expect(sql).toMatch(/admin_service_controls_known_service CHECK \([\s\S]*'google-sign-in'/);
    expect(sql).toMatch(/admin_activity_log_known_service CHECK \([\s\S]*'google-sign-in'/);
    expect(sql).toContain("VALUES ('google-sign-in')");
    expect(sql).toContain("ON CONFLICT (service_key) DO NOTHING");
    // No provider token column anywhere — the flow drops the access token.
    expect(sql).not.toMatch(/access_token|refresh_token|id_token/);
  });

  it("documents the two server-only env vars and never a NEXT_PUBLIC_ variant", async () => {
    const env = await source(".env.example");
    expect(env).toContain("GOOGLE_OAUTH_CLIENT_ID=");
    expect(env).toContain("GOOGLE_OAUTH_CLIENT_SECRET=");
    expect(env).toContain("/api/account/google/callback");
    expect(env).not.toContain("NEXT_PUBLIC_GOOGLE");
  });
});

describe("checkGoogleSignInHealth", () => {
  it("is amber and says dormant with no DATABASE_URL and no client", async () => {
    const check = await checkGoogleSignInHealth({ env: {} });
    expect(check).toMatchObject({ id: "google-sign-in", label: "Google sign-in", status: "amber" });
    expect(check.message).toContain("DATABASE_URL is not configured");
    expect(check.message).toContain("Dormant");
  });

  it("is green with counts when configured and the table answers", async () => {
    const check = await checkGoogleSignInHealth({ env: CONFIGURED, ping: async () => ({ accounts: 4, linked: 2, signedIn7d: 3 }) });
    expect(check.status).toBe("green");
    expect(check.message).toContain("4 account(s), 2 linked to a wallet, 3 signed in this week.");
  });

  it("stays amber when the table answers but the client or the encryption key is missing", async () => {
    const noClient = await checkGoogleSignInHealth({ env: { DATABASE_URL: "postgres://x" }, ping: async () => ({ accounts: 0, linked: 0, signedIn7d: 0 }) });
    expect(noClient.status).toBe("amber");
    const noKey = await checkGoogleSignInHealth({
      env: { DATABASE_URL: "postgres://x", GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "s" },
      ping: async () => ({ accounts: 0, linked: 0, signedIn7d: 0 }),
    });
    expect(noKey.status).toBe("amber");
    expect(noKey.message).toContain("SOCIAL_CREDENTIALS_ENCRYPTION_KEY is missing");
  });

  it("is red and names migration 033 when the table cannot be read", async () => {
    const check = await checkGoogleSignInHealth({
      env: CONFIGURED,
      ping: async () => {
        throw new Error("relation user_accounts does not exist");
      },
    });
    expect(check.status).toBe("red");
    expect(check.message).toContain("033_user_accounts.sql");
  });
});

describe("buildGoogleSignInPipeline", () => {
  it("reports the six stages, amber for storage when DATABASE_URL is unset", async () => {
    const pipeline = await buildGoogleSignInPipeline({ env: {}, getServiceControl: notIsolated });
    expect(pipeline.id).toBe("google-sign-in");
    expect(pipeline.stages.map((stage) => stage.id)).toEqual(["endpoint-reachable", "oauth-client", "encryption-key", "callback-url", "table-exists", "account-counts"]);
    expect(pipeline.stages.find((stage) => stage.id === "oauth-client")?.status).toBe("amber");
    expect(pipeline.stages.find((stage) => stage.id === "callback-url")?.status).toBe("amber");
    expect(pipeline.stages.find((stage) => stage.id === "table-exists")?.status).toBe("amber");
  });

  it("names the exact redirect URI to register with Google when HOODLUMS_APP_ORIGIN is set", async () => {
    const pipeline = await buildGoogleSignInPipeline({ env: { ...CONFIGURED, HOODLUMS_APP_ORIGIN: "https://hoodlums.dev" }, getServiceControl: notIsolated, getStore: () => createMemoryUserAccountsStore() });
    const callback = pipeline.stages.find((stage) => stage.id === "callback-url");
    expect(callback?.status).toBe("green");
    expect(callback?.message).toContain("https://hoodlums.dev/api/account/google/callback");
    expect(pipeline.stages.find((stage) => stage.id === "oauth-client")?.status).toBe("green");
    expect(pipeline.stages.find((stage) => stage.id === "encryption-key")?.status).toBe("green");
  });

  it("is green with counts when the tables exist, red naming migration 033 when they do not", async () => {
    const store = createMemoryUserAccountsStore();
    await store.upsertGoogleAccount({ googleSub: "a", email: "a@x.y", emailVerified: true, displayName: "" }, NOW);
    const healthy = await buildGoogleSignInPipeline({ env: CONFIGURED, getServiceControl: notIsolated, getStore: () => store, now: NOW });
    expect(healthy.stages.find((stage) => stage.id === "table-exists")?.status).toBe("green");
    expect(healthy.stages.find((stage) => stage.id === "account-counts")?.message).toBe("1 account(s), 0 linked to a wallet, 1 signed in this week.");

    store.tablesPresent = false;
    const missing = await buildGoogleSignInPipeline({ env: CONFIGURED, getServiceControl: notIsolated, getStore: () => store, now: NOW });
    expect(missing.stages.find((stage) => stage.id === "table-exists")?.status).toBe("red");
    expect(missing.stages.find((stage) => stage.id === "table-exists")?.message).toContain("033_user_accounts.sql");
    expect(missing.stages.find((stage) => stage.id === "account-counts")?.status).toBe("amber");
  });

  it("is dispatched by buildServicePipeline", async () => {
    const pipeline = await buildServicePipeline("google-sign-in", { env: {}, googleSignIn: { getServiceControl: notIsolated } });
    expect(pipeline?.id).toBe("google-sign-in");
    expect(pipeline?.label).toBe("Google sign-in");
  });
});

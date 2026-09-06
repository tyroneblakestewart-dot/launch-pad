import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { DELETE as endSession, GET as sessionStatus, POST as startSession } from "@/app/api/social/approval-session/route";
import { POST as socialChallenge } from "@/app/api/social/challenge/route";
import { GET as getMascotImageUsage } from "@/app/api/social/mascot/image/route";
import { POST as createPost } from "@/app/api/social/posts/route";
import { ADMIN_SERVICE_DEFINITIONS } from "@/lib/admin-operations";
import { GENERATE_SITE_STYLE_HEADER, resetSocialStudioActionRateLimitsForTests, resetSocialStudioRateLimitsForTests } from "@/lib/server/api-protection";
import { resetChatChallengesForTests } from "@/lib/server/chat-auth";
import {
  createMemoryMascotImageUsageStore,
  resetMascotImageUsageStoreForTests,
  setMascotImageUsageStoreForTests,
} from "@/lib/server/mascot-image-usage-store";
import {
  SOCIAL_APPROVAL_SESSION_COOKIE,
  SOCIAL_APPROVAL_SESSION_PAYLOAD,
  SOCIAL_APPROVAL_SESSION_PURPOSE,
  SOCIAL_APPROVAL_SESSION_TTL_MS,
} from "@/lib/server/social-approval-session";
import {
  createMemorySocialApprovalSessionStore,
  resetSocialApprovalSessionStoreForTests,
  setSocialApprovalSessionStoreForTests,
} from "@/lib/server/social-approval-session-store";
import { getSocialConnectionsStore, resetSocialConnectionsStoreForTests, setSocialConnectionsStoreForTests } from "@/lib/server/social-connections-store";
import { resetSocialScheduledPostsStoreForTests, setSocialScheduledPostsStoreForTests } from "@/lib/server/social-scheduled-posts-store";
import { SOCIAL_STUDIO_ACTION_PURPOSES } from "@/lib/server/social-studio-action-auth";
import { resetSocialStudioAuthoriserForTests } from "@/lib/server/social-studio-entitlement";
import { buildSocialPostingPipeline } from "@/lib/server/system-health-pipeline";
import * as clientConstants from "@/lib/social-approval-session-client";
import { MIN_SCHEDULE_LEAD_MS, approvalDestinations, ensureFutureScheduledAt } from "@/lib/social-studio-queue";
import { createMemorySocialConnectionsStore } from "./social-connections-test-helpers";
import { createMemorySocialScheduledPostsStore } from "./social-scheduled-posts-test-helpers";

const ROOT = process.cwd();
async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}
function block(text: string, start: string, length: number): string {
  const index = text.indexOf(start);
  expect(index, `expected to find ${start}`).toBeGreaterThan(-1);
  return text.slice(index, index + length);
}

const ACCOUNT = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`);
const OTHER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as `0x${string}`);
const ORIGIN = "http://localhost:3000";

function postRequest(pathname: string, body: unknown, cookie?: string) {
  return new Request(`${ORIGIN}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}
function getRequest(pathname: string, cookie?: string) {
  return new Request(`${ORIGIN}${pathname}`, { method: "GET", headers: cookie ? { Cookie: cookie } : {} });
}
async function signedAction(purpose: string, payload: Record<string, string>, account = ACCOUNT) {
  const challengeResponse = await socialChallenge(
    postRequest("/api/social/challenge", { walletAddress: account.address, walletChainId: 46630, purpose, payload }),
  );
  expect(challengeResponse.status).toBe(201);
  const challenge = (await challengeResponse.json()) as { challengeId: string; nonce: string; message: string };
  const signature = await account.signMessage({ message: challenge.message });
  return { challengeId: challenge.challengeId, nonce: challenge.nonce, signature };
}
function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie") || "";
  const match = header.match(new RegExp(`${SOCIAL_APPROVAL_SESSION_COOKIE}=([^;]*)`));
  expect(match, "expected the approval cookie to be set").not.toBeNull();
  return `${SOCIAL_APPROVAL_SESSION_COOKIE}=${match![1]}`;
}

beforeEach(() => {
  process.env.SOCIAL_STUDIO_ALLOWED_ORIGIN = ORIGIN;
  resetSocialStudioActionRateLimitsForTests();
  resetChatChallengesForTests();
  setSocialConnectionsStoreForTests(createMemorySocialConnectionsStore());
  setSocialScheduledPostsStoreForTests(createMemorySocialScheduledPostsStore());
  setSocialApprovalSessionStoreForTests(createMemorySocialApprovalSessionStore());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSocialConnectionsStoreForTests();
  resetSocialScheduledPostsStoreForTests();
  resetSocialApprovalSessionStoreForTests();
  resetSocialStudioAuthoriserForTests();
  delete process.env.SOCIAL_STUDIO_ALLOWED_ORIGIN;
});

describe("one signature a day: the approval session (owner direction, 6 Sep 2026)", () => {
  it("is a registered wallet-signed purpose, and the client mirrors the server's purpose and payload exactly", () => {
    expect(SOCIAL_STUDIO_ACTION_PURPOSES).toContain("social:approval-session");
    expect(clientConstants.SOCIAL_APPROVAL_SESSION_PURPOSE).toBe(SOCIAL_APPROVAL_SESSION_PURPOSE);
    expect(clientConstants.SOCIAL_APPROVAL_SESSION_PAYLOAD).toEqual(SOCIAL_APPROVAL_SESSION_PAYLOAD);
    expect(SOCIAL_APPROVAL_SESSION_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("the store honours expiry and revocation and only ever sees a hash", async () => {
    const store = createMemorySocialApprovalSessionStore();
    const now = new Date("2026-09-06T17:00:00.000Z");
    await store.create(ACCOUNT.address, "a".repeat(64), new Date(now.getTime() + 1000));
    expect(await store.get("a".repeat(64), now)).toEqual({ walletAddress: ACCOUNT.address.toLowerCase(), expiresAt: new Date(now.getTime() + 1000).toISOString() });
    expect(await store.get("a".repeat(64), new Date(now.getTime() + 1000))).toBeNull();
    expect(await store.countActive(now)).toBe(1);
    await store.revoke("a".repeat(64), now);
    expect(await store.get("a".repeat(64), now)).toBeNull();
    expect(await store.countActive(now)).toBe(0);
  });

  it("POST takes one wallet signature, sets an httpOnly cookie, and GET then reports the session live for that wallet only", async () => {
    const auth = await signedAction(SOCIAL_APPROVAL_SESSION_PURPOSE, SOCIAL_APPROVAL_SESSION_PAYLOAD);
    const started = await startSession(postRequest("/api/social/approval-session", auth));
    expect(started.status).toBe(201);
    const setCookie = started.headers.get("set-cookie") || "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
    const cookie = cookieFrom(started);
    expect(cookie).not.toContain("=;");

    const mine = await sessionStatus(getRequest(`/api/social/approval-session?walletAddress=${ACCOUNT.address}`, cookie));
    expect((await mine.json()) as unknown).toMatchObject({ active: true });
    const theirs = await sessionStatus(getRequest(`/api/social/approval-session?walletAddress=${OTHER.address}`, cookie));
    expect((await theirs.json()) as unknown).toMatchObject({ active: false, expiresAt: null });
    const none = await sessionStatus(getRequest(`/api/social/approval-session?walletAddress=${ACCOUNT.address}`));
    expect((await none.json()) as unknown).toMatchObject({ active: false });
  });

  it("refuses a signature over any other purpose or a bad signature, and 503s (never a fake session) when the table is missing", async () => {
    const wrongPurpose = await signedAction("social:post-cancel", { postId: "x" });
    expect((await startSession(postRequest("/api/social/approval-session", wrongPurpose))).status).toBe(401);
    const auth = await signedAction(SOCIAL_APPROVAL_SESSION_PURPOSE, SOCIAL_APPROVAL_SESSION_PAYLOAD);
    expect((await startSession(postRequest("/api/social/approval-session", { ...auth, signature: "0xdead" }))).status).toBe(401);
    expect((await startSession(postRequest("/api/social/approval-session", {}))).status).toBe(400);

    resetSocialApprovalSessionStoreForTests();
    delete process.env.DATABASE_URL;
    const fresh = await signedAction(SOCIAL_APPROVAL_SESSION_PURPOSE, SOCIAL_APPROVAL_SESSION_PAYLOAD);
    const unavailable = await startSession(postRequest("/api/social/approval-session", fresh));
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("set-cookie")).toBeNull();
  });

  it("approves a post with the session cookie and no signature, for the session's wallet only, and refuses once locked", async () => {
    await getSocialConnectionsStore().upsert({ walletAddress: ACCOUNT.address, platform: "x", displayName: "@x", externalId: "1", credentials: JSON.stringify({ accessToken: "a", accessSecret: "b" }) });
    const auth = await signedAction(SOCIAL_APPROVAL_SESSION_PURPOSE, SOCIAL_APPROVAL_SESSION_PAYLOAD);
    const cookie = cookieFrom(await startSession(postRequest("/api/social/approval-session", auth)));
    const scheduledAt = new Date(Date.now() + 5 * 60_000).toISOString();

    const approved = await createPost(
      postRequest("/api/social/posts", { body: "gm hoodlums", walletAddress: ACCOUNT.address, destinations: ["x"], scheduledAt }, cookie),
    );
    expect(approved.status).toBe(201);
    const created = (await approved.json()) as { post: { approvedByWallet: string; status: string } };
    expect(created.post.status).toBe("scheduled");
    expect(created.post.approvedByWallet.toLowerCase()).toBe(ACCOUNT.address.toLowerCase());

    // A cookie for one wallet never approves as another.
    const mismatch = await createPost(
      postRequest("/api/social/posts", { body: "gm again", walletAddress: OTHER.address, destinations: ["x"], scheduledAt }, cookie),
    );
    expect(mismatch.status).toBe(403);
    expect(((await mismatch.json()) as { code: string }).code).toBe("approval-session-wallet-mismatch");

    // No cookie and no signature: asked to sign or unlock.
    const bare = await createPost(postRequest("/api/social/posts", { body: "gm", walletAddress: ACCOUNT.address, destinations: ["x"], scheduledAt }));
    expect(bare.status).toBe(401);
    expect(((await bare.json()) as { code: string }).code).toBe("approval-session-required");

    // Lock: the cookie is cleared and the stored session revoked.
    const ended = await endSession(new Request(`${ORIGIN}/api/social/approval-session`, { method: "DELETE", headers: { Origin: ORIGIN, Cookie: cookie } }));
    expect(ended.status).toBe(200);
    expect(ended.headers.get("set-cookie") || "").toContain(`${SOCIAL_APPROVAL_SESSION_COOKIE}=;`);
    const afterLock = await createPost(
      postRequest("/api/social/posts", { body: "gm later", walletAddress: ACCOUNT.address, destinations: ["x"], scheduledAt }, cookie),
    );
    expect(afterLock.status).toBe(401);
  });

  it("the per-post signature path is unchanged: a signed approval still works with no cookie at all", async () => {
    await getSocialConnectionsStore().upsert({ walletAddress: ACCOUNT.address, platform: "x", displayName: "@x", externalId: "1", credentials: JSON.stringify({ accessToken: "a", accessSecret: "b" }) });
    const scheduledAt = new Date().toISOString();
    const auth = await signedAction("social:post-create", { body: "gm signed", destinations: "x", scheduledAt });
    const response = await createPost(postRequest("/api/social/posts", { body: "gm signed", destinations: ["x"], scheduledAt, ...auth }));
    expect(response.status).toBe(201);
  });

  it("the migration creates the table idempotently, the service definition names the route, and the health stage reports amber until applied", async () => {
    const sql = await source("db", "migrations", "034_social_approval_sessions.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS social_approval_sessions");
    expect(sql).toContain("session_token_hash CHAR(64) PRIMARY KEY");
    expect(sql).toContain("revoked_at TIMESTAMPTZ");
    expect(sql).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(ADMIN_SERVICE_DEFINITIONS.find((definition) => definition.key === "social-posting")?.affectedRoutes).toContain("/api/social/approval-session");
    const admin = await source("lib", "admin-operations.ts");
    expect(admin).toContain('| "social-approvals-unlocked"');
    expect(admin).toContain('| "social-approvals-locked"');

    const fakePool = (rows: (text: string) => Array<Record<string, unknown>>) => ({
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
      query: async (text: string) => ({ rows: rows(text) }),
    });
    const missing = await buildSocialPostingPipeline({
      env: { DATABASE_URL: "postgres://test" },
      getServiceControl: async () => ({ key: "social-posting", label: "", description: "", affectedRoutes: "", isolated: false, reason: "", updatedAt: new Date().toISOString() }) as never,
      getPool: (() =>
        fakePool((text) =>
          text.includes("social_project_slots")
            ? [{ table_name: "social_project_slots" }]
            : text.includes("social_scheduled_posts") && text.includes("information_schema")
              ? [{ table_name: "social_scheduled_posts" }]
              : [],
        )) as never,
    });
    const stage = missing.stages.find((entry) => entry.id === "approval-sessions");
    expect(stage?.status).toBe("amber");
    expect(stage?.message).toContain("034_social_approval_sessions.sql");
  });
});

describe("the allowance read works from a same-page GET (no Origin header)", () => {
  beforeEach(() => {
    process.env.GENERATE_SITE_STYLE_SHARED_SECRET = "hoodlums-test-secret";
    resetSocialStudioRateLimitsForTests();
    setMascotImageUsageStoreForTests(createMemoryMascotImageUsageStore());
  });
  afterEach(() => {
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    resetMascotImageUsageStoreForTests();
  });

  it("answers with the secret header alone — browsers omit Origin on same-origin GETs, which 401'd every real read", async () => {
    const response = await getMascotImageUsage(
      new Request(`https://hoodlums.dev/api/social/mascot/image?walletAddress=${ACCOUNT.address}&projectId=proj-1`, {
        headers: { [GENERATE_SITE_STYLE_HEADER]: "hoodlums-test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { usage: { usedToday: number } }).usage.usedToday).toBe(0);
    const unauthorised = await getMascotImageUsage(new Request(`https://hoodlums.dev/api/social/mascot/image?walletAddress=${ACCOUNT.address}`));
    expect(unauthorised.status).toBe(401);
  });
});

describe("one-tap approval maths", () => {
  it("destinations are every connected platform whose field carries text", () => {
    expect(approvalDestinations({ xText: "hi", telegramText: "" }, ["x", "telegram"])).toEqual(["x"]);
    expect(approvalDestinations({ xText: "hi", telegramText: "hello" }, ["telegram"])).toEqual(["telegram"]);
    expect(approvalDestinations({ xText: "  ", telegramText: "hello" }, ["x", "telegram"])).toEqual(["telegram"]);
    expect(approvalDestinations({ xText: "hi", telegramText: "hello" }, [])).toEqual([]);
  });

  it("a time already passed (or too close) at approval moves to now plus the lead; a future pick is kept", () => {
    const now = new Date("2026-09-06T17:41:00.000Z");
    expect(MIN_SCHEDULE_LEAD_MS).toBe(2 * 60 * 1000);
    expect(ensureFutureScheduledAt(new Date("2026-09-06T17:40:00.000Z"), now).toISOString()).toBe("2026-09-06T17:43:00.000Z");
    expect(ensureFutureScheduledAt(new Date("2026-09-06T17:42:00.000Z"), now).toISOString()).toBe("2026-09-06T17:43:00.000Z");
    expect(ensureFutureScheduledAt(new Date("2026-09-06T19:00:00.000Z"), now).toISOString()).toBe("2026-09-06T19:00:00.000Z");
    expect(ensureFutureScheduledAt(new Date(Number.NaN), now).toISOString()).toBe("2026-09-06T17:43:00.000Z");
  });
});

describe("Queue tab: one tap, one signature a day, slimmer card (source pins)", () => {
  it("Approve is one tap from the row or the card — no confirm step, no destination toggles", async () => {
    const hub = await source("components", "social-hub.tsx");
    const handler = block(hub, "function handleApproveClick(item: QueueItem)", 120);
    expect(handler).toContain("void approveQueueItem(item);");
    expect(hub).not.toContain("pendingApprovalItemId");
    expect(hub).not.toContain("toggleItemDestination");
    expect(hub).not.toContain("Confirm & approve");
    expect(hub).toContain("const destinations = approvalDestinations(item, myConnectedPlatforms);");
    // The quick-send confirm (issue #382) is deliberately kept: it publishes immediately.
    expect(hub).toContain("function handleQuickSendClick(item: QueueItem, platform: SocialPlatform)");
    expect(hub).toContain("Sending to {isPendingQuickSendX ? \"X\" : \"Telegram\"} only.");
  });

  it("the first approval unlocks the day with one signature, falls back to per-post signing when the table is missing, and the header offers Lock", async () => {
    const hub = await source("components", "social-hub.tsx");
    const ensure = block(hub, "async function ensureApprovalSession()", 1300);
    expect(ensure).toContain("if (approvalSession && new Date(approvalSession.expiresAt).getTime() > Date.now()) return \"session\";");
    expect(ensure).toContain("signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.approvalSession, SOCIAL_APPROVAL_SESSION_PAYLOAD)");
    expect(ensure).toContain('if (response.status === 503) return "signature";');
    const approve = block(hub, "async function approveQueueItem(item: QueueItem)", 5200);
    expect(approve).toContain("authMode = await ensureApprovalSession();");
    expect(approve).toContain('authMode === "signature"\n              ? await signSocialStudioChallenge(SOCIAL_STUDIO_ACTION_PURPOSES.postCreate, {');
    expect(approve).toContain("walletAddress,\n              projectId: selectedProject.id,");
    expect(hub).toContain("Approvals unlocked until {formatScheduledAt(approvalSession.expiresAt)} · one tap, no signature");
    expect(hub).toContain("First approval today asks for one wallet signature · then one tap for 24h");
    expect(hub).toContain("async function lockApprovals()");
    expect(hub).toContain('await fetch("/api/social/approval-session", { method: "DELETE" });');
  });

  it("the schedule is decided at approval and never in the past", async () => {
    const hub = await source("components", "social-hub.tsx");
    const approve = block(hub, "async function approveQueueItem(item: QueueItem)", 5200);
    expect(approve).toContain("const now = new Date();");
    expect(approve).toContain("scheduledPosts.filter((post) => isPendingSendStatus(post.status)).map((post) => post.scheduledAt);");
    expect(approve).toContain("computeDefaultScheduledAt(awaitingIso, now, cadenceSpreadHoursMs(postingCadence));");
    expect(approve).toContain("const scheduledAtIso = ensureFutureScheduledAt(picked, now).toISOString();");
    expect(approve.indexOf("ensureFutureScheduledAt(picked, now)")).toBeLessThan(approve.indexOf('fetch("/api/social/posts"'));
  });

  it("the card is slimmer: no destination toggles, the schedule picker sits in the action row, the destination tag is derived", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).not.toContain("className={styles.destinationToggles}>\n                                    {myConnectedPlatforms.map(");
    const actions = block(hub, "<div className={styles.queueItemActions}>", 2400);
    expect(actions).toContain('className={styles.queueActionDelete} onClick={() => removeQueueItem(item.id)}');
    expect(actions.indexOf("className={styles.scheduleCompact}")).toBeGreaterThan(actions.indexOf("removeQueueItem(item.id)"));
    expect(hub).toContain('destinations.length === 2 ? "Both" : destinations.length === 1 ? platformLabel(destinations[0]) : "Nowhere yet"');
    const css = await source("components", "social-hub.module.css");
    expect(css).toContain(".queueItemActions .scheduleCompact { margin-left: auto; }");
    expect(css).toMatch(/@media \(max-width: 640px\) \{\n  \.queueItemActions \.scheduleCompact \{ margin-left: 0; width: 100%; \}/);
  });
});

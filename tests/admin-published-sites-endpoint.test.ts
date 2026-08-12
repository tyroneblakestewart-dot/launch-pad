import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PATCH as patchPublishedSites } from "@/app/api/admin/published-sites/route";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";
import {
  createMemoryAdminOperationsStore,
  getAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import type { PublicGeneratedSite } from "@/lib/public-site";
import {
  resetPublishStoreForTests,
  setPublishStoreForTests,
  type PublishSignatureVerifier,
  type PublishStore,
  type PublishStoreResult,
  type PublishWithChallengeInput,
  type UpdateContractAddressInput,
  type UpdateContractAddressResult,
} from "@/lib/server/publish-store";
import type { PublishChallenge } from "@/lib/server/publish-auth";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-published-sites-test-session-token";
let cookie = "";

function baseSite(slug: string): PublicGeneratedSite {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    slug,
    name: "Bult",
    ticker: "BLTL",
    description: "A published site fixture for the attach-address admin endpoint.",
    supply: "1000000000",
    decimals: 18,
    chain: "robinhood",
    heroImage: "",
    generatedSiteHtml: null,
    contractAddress: "",
    xHandle: "",
    telegram: "",
    status: "prepared",
    visibility: "live",
    createdAt: now,
    updatedAt: now,
  };
}

class MemoryPublishStore implements PublishStore {
  readonly sites = new Map<string, PublicGeneratedSite>();

  async createChallenge(): Promise<PublishChallenge> {
    throw new Error("not used in this test");
  }

  async publishWithChallenge(
    _input: PublishWithChallengeInput,
    _verifySignature: PublishSignatureVerifier,
  ): Promise<PublishStoreResult> {
    throw new Error("not used in this test");
  }

  async getBySlug(slug: string): Promise<PublicGeneratedSite | null> {
    return this.sites.get(slug) || null;
  }

  async listLive(): Promise<PublicGeneratedSite[]> {
    return [...this.sites.values()];
  }

  async updateContractAddress(input: UpdateContractAddressInput): Promise<UpdateContractAddressResult> {
    const existing = this.sites.get(input.slug);
    if (!existing) return { status: "site_not_found" };
    const updated = { ...existing, contractAddress: input.contractAddress };
    this.sites.set(input.slug, updated);
    return { status: "updated", site: updated };
  }
}

function request(body?: unknown, options: { authenticated?: boolean; origin?: string } = {}): Request {
  const { authenticated = true, origin = ORIGIN } = options;
  return new Request(`${ORIGIN}/api/admin/published-sites`, {
    method: "PATCH",
    headers: {
      ...(authenticated ? { Cookie: cookie } : {}),
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(async () => {
  setAdminSessionStoreForTests(createMemoryAdminSessionStore());
  setAdminOperationsStoreForTests(createMemoryAdminOperationsStore());
  await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
  cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
});

afterEach(() => {
  resetAdminStoresForTests();
  resetAdminOperationsStoreForTests();
  resetPublishStoreForTests();
});

describe("PATCH /api/admin/published-sites", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await patchPublishedSites(
      request({ slug: "bltl", contractAddress: "0x1111111111111111111111111111111111111111" }, { authenticated: false }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a disallowed origin", async () => {
    const response = await patchPublishedSites(
      request(
        { slug: "bltl", contractAddress: "0x1111111111111111111111111111111111111111" },
        { origin: "https://evil.example" },
      ),
    );
    expect(response.status).toBe(403);
  });

  it("rejects an invalid slug", async () => {
    const store = new MemoryPublishStore();
    setPublishStoreForTests(store);

    const response = await patchPublishedSites(
      request({ slug: "Not Valid!", contractAddress: "0x1111111111111111111111111111111111111111" }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a malformed contract address", async () => {
    const store = new MemoryPublishStore();
    setPublishStoreForTests(store);

    const response = await patchPublishedSites(request({ slug: "bltl", contractAddress: "not an address!" }));
    expect(response.status).toBe(400);
  });

  it("rejects an empty contract address", async () => {
    const store = new MemoryPublishStore();
    setPublishStoreForTests(store);

    const response = await patchPublishedSites(request({ slug: "bltl", contractAddress: "" }));
    expect(response.status).toBe(400);
  });

  it("returns 404 when the slug has no published site", async () => {
    const store = new MemoryPublishStore();
    setPublishStoreForTests(store);

    const response = await patchPublishedSites(
      request({ slug: "does-not-exist", contractAddress: "0x1111111111111111111111111111111111111111" }),
    );
    expect(response.status).toBe(404);
  });

  it("attaches the contract address to an existing published site and logs the change", async () => {
    const store = new MemoryPublishStore();
    store.sites.set("bltl", baseSite("bltl"));
    setPublishStoreForTests(store);

    const address = "0x1111111111111111111111111111111111111111";
    const response = await patchPublishedSites(request({ slug: "bltl", contractAddress: address }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { site: PublicGeneratedSite };
    expect(payload.site.contractAddress).toBe(address);
    expect(await store.getBySlug("bltl")).toMatchObject({ contractAddress: address });

    const activity = await getAdminOperationsStore().listActivity(10);
    expect(activity.some((item) => item.kind === "site-contract-address-attached" && item.message.includes(address))).toBe(
      true,
    );
  });

  it("can correct an already-attached contract address", async () => {
    const store = new MemoryPublishStore();
    store.sites.set("bltl", { ...baseSite("bltl"), contractAddress: "0x1111111111111111111111111111111111111111" });
    setPublishStoreForTests(store);

    const corrected = "0x2222222222222222222222222222222222222222";
    const response = await patchPublishedSites(request({ slug: "bltl", contractAddress: corrected }));
    expect(response.status).toBe(200);
    expect(await store.getBySlug("bltl")).toMatchObject({ contractAddress: corrected });
  });
});
